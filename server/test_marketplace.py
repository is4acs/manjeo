"""Four-role HTTP contracts, shared by SQLite and isolated PostgreSQL tests."""
import base64
import copy
import http.client
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from server import app
from server import test_app


class MarketplaceContracts:
    def menu(self, restaurant="ti-kreol", role="restaurant"):
        if role not in self.cookies:
            self.login(role)
        return self.request("GET", "/api/restaurants/" + restaurant + "/menu", role=role)[0]["menu"]

    def publish(self, menu, restaurant="ti-kreol", role="restaurant", status=200):
        return self.request("PATCH", "/api/restaurants/" + restaurant + "/menu", menu, role=role, status=status)[0]

    def ready_order(self):
        order = self.create_order()
        if "restaurant" not in self.cookies:
            self.login("restaurant")
        for status in ("accepted", "preparing", "ready"):
            self.request("PATCH", "/api/orders/" + order["id"], {"status": status}, role="restaurant")
        return self.request("GET", "/api/orders", role="client")[0]["orders"][0]

    def online(self, role="courier"):
        if role not in self.cookies:
            self.login(role)
        return self.request("PATCH", "/api/courier/profile", {"online": True}, role=role)[0]["profile"]

    def concurrent(self, requests):
        barrier = threading.Barrier(len(requests))

        def send(spec):
            method, path, data, role = spec
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
            headers = {"Content-Type": "application/json", "Cookie": self.cookies[role],
                       "Origin": "http://127.0.0.1:%d" % self.port}
            barrier.wait(timeout=10)
            connection.request(method, path, json.dumps(data), headers)
            response = connection.getresponse()
            result = response.status, json.loads(response.read())
            connection.close()
            return result

        with ThreadPoolExecutor(max_workers=len(requests)) as executor:
            return list(executor.map(send, requests))

    def reload_application(self):
        if hasattr(self.database, "dsn"):
            database = type(self.database)(self.database.dsn, schema=self.database.schema)
        else:
            database = app.Database(self.database.path)
        self.database = database
        self.server.database = database
        self.server.application = app.AppState(database, app.AppConfig(cloud=False))
        return database

    def test_menu_create_update_options_categories_and_optimistic_concurrency(self):
        menu = self.menu()
        original = copy.deepcopy(menu)
        product = {
            "id": str(uuid.uuid4()), "name": "Assiette personnalisée", "description": "Recette de démonstration.",
            "price": 1500, "group": "À composer", "image": "/images/chicken.jpg", "allergens": "Lait, soja",
            "popular": True, "available": True, "archived": False,
            "optionGroups": [{"id": "base", "name": "Accompagnement", "min": 1, "max": 1,
                              "choices": [{"id": "riz", "name": "Riz", "price": 0}, {"id": "patate", "name": "Patate douce", "price": 200}]},
                             {"id": "extras", "name": "Suppléments", "min": 0, "max": 2,
                              "choices": [{"id": "oeuf", "name": "Œuf", "price": 100}, {"id": "avocat", "name": "Avocat", "price": 250}]}],
        }
        menu["categories"] += ["À composer", "Catégorie vide"]
        menu["products"].append(product)
        published = self.publish(menu)["menu"]
        self.assertGreater(published["version"], original["version"])
        saved = next(row for row in published["products"] if row["id"] == product["id"])
        self.assertEqual(saved["allergens"], "Lait, soja")
        self.assertEqual(saved["optionGroups"], product["optionGroups"])
        self.assertGreaterEqual(saved["version"], 1)
        payload = self.order_payload(product=product["id"])
        payload["items"][0].update(quantity=1, selections=[{"groupId": "base", "choiceIds": ["patate"]},
                                                          {"groupId": "extras", "choiceIds": ["oeuf", "avocat"]}], unitPrice=2050)
        payload["expectedTotal"] = 2300
        order = self.create_order(payload)
        self.assertEqual(order["total"], 2300)
        self.assertIn("Patate douce", order["items"][0]["option"])
        self.assertIn("Avocat", order["items"][0]["option"])
        old_product_version = saved["version"]
        saved.update(name="Assiette revisitée", price=1800, group="Les plats")
        updated = self.publish(published)["menu"]
        self.assertGreater(next(row for row in updated["products"] if row["id"] == product["id"])["version"], old_product_version)
        self.publish(original, status=409)
        persisted = self.request("GET", "/api/orders", role="client")[0]["orders"][0]
        self.assertEqual(persisted["items"], order["items"])
        self.assertEqual(persisted["total"], 2300)
        self.reload_application()
        self.assertEqual(self.menu(), updated)

    def test_menu_validation_is_atomic_and_owner_scoped(self):
        original = self.menu()
        self.login("admin")
        self.login("client")
        self.login("courier")
        for role in ("client", "courier"):
            self.request("GET", "/api/restaurants/ti-kreol/menu", role=role, status=403)
            self.publish(original, role=role, status=403)
        self.request("GET", "/api/restaurants/smash-club/menu", role="restaurant", status=403)
        self.publish(original, restaurant="smash-club", status=403)
        invalid_menus = []
        for field, value in (("price", -1), ("price", 1.5), ("price", True), ("price", 100001),
                             ("name", ""), ("name", "x" * 1000), ("image", "javascript:alert(1)"),
                             ("group", "Catégorie inexistante")):
            menu = copy.deepcopy(original)
            menu["products"][0][field] = value
            invalid_menus.append(menu)
        menu = copy.deepcopy(original)
        menu["products"][0]["name"] = "Cette modification doit être annulée"
        menu["products"][1]["optionGroups"] = [{"id": "bad", "name": "Choix", "min": 2, "max": 1,
                                               "choices": [{"id": "x", "name": "X", "price": 0}]}]
        invalid_menus.append(menu)
        menu = copy.deepcopy(original)
        menu["products"].append(copy.deepcopy(menu["products"][0]))
        invalid_menus.append(menu)
        for menu in invalid_menus:
            with self.subTest(menu=menu):
                self.publish(menu, status=400)
                self.assertEqual(self.menu(), original)
        foreign = self.menu("smash-club", "admin")["products"][0]
        menu = copy.deepcopy(original)
        foreign["group"] = menu["categories"][0]
        menu["products"].append(foreign)
        self.publish(menu, status=400)
        self.assertEqual(self.menu(), original)

    def test_menu_concurrent_publication_has_one_winner(self):
        menu = self.menu()
        first, second = copy.deepcopy(menu), copy.deepcopy(menu)
        first["products"][0]["name"] = "Première publication"
        second["products"][0]["name"] = "Deuxième publication"
        results = self.concurrent([("PATCH", "/api/restaurants/ti-kreol/menu", first, "restaurant"),
                                   ("PATCH", "/api/restaurants/ti-kreol/menu", second, "restaurant")])
        self.assertEqual(sorted(code for code, _ in results), [200, 409], results)
        winner = next(body["menu"] for code, body in results if code == 200)
        self.assertEqual(self.menu(), winner)

    def test_archive_restore_empty_categories_and_restart_preserve_history(self):
        order = self.create_order()
        stale_order = self.order_payload()
        menu = self.menu()
        menu["products"] = [product for product in menu["products"] if product["id"] != "kreol-poulet"]
        menu["categories"] += ["Nouvelle catégorie vide"]
        menu = self.publish(menu)["menu"]
        archived = next(product for product in menu["products"] if product["id"] == "kreol-poulet")
        self.assertTrue(archived["archived"])
        self.request("POST", "/api/orders", stale_order, role="client", status=409)
        catalog = self.request("GET", "/api/restaurants")[0]["restaurants"][0]
        self.assertNotIn("kreol-poulet", {product["id"] for product in catalog["products"]})
        self.reload_application()
        self.assertEqual(self.menu(), menu)
        persisted = self.request("GET", "/api/orders", role="client")[0]["orders"][0]
        self.assertEqual(persisted["items"], order["items"])
        archived["archived"] = False
        restored = self.publish(menu)["menu"]
        self.assertFalse(next(product for product in restored["products"] if product["id"] == "kreol-poulet")["archived"])
        self.create_order()

    def test_availability_changes_invalidate_editor_and_cart_versions(self):
        payload = self.order_payload()
        self.login("client")
        menu = self.menu()
        self.request("PATCH", "/api/restaurants/ti-kreol/products/kreol-poulet", {"available": False}, role="restaurant")
        self.publish(menu, status=409)
        self.request("PATCH", "/api/restaurants/ti-kreol/products/kreol-poulet", {"available": True}, role="restaurant")
        updated = self.menu()
        self.assertGreater(updated["version"], menu["version"])
        self.request("POST", "/api/orders", payload, role="client", status=409)
        self.create_order()

    def test_restaurant_profile_updates_future_pickup_and_preserves_order_snapshot(self):
        order = self.create_order()
        self.login("restaurant")
        self.login("courier")
        endpoint = "/api/restaurants/ti-kreol"
        patch = {"name": "Ti Kaz version test", "description": "Recettes guyanaises de démonstration",
                 "minutes": 35, "pickupAddress": "22 avenue des Tests", "pickupCity": "Matoury"}
        self.request("PATCH", endpoint, patch, role="courier", status=403)
        for field, value in (("pickupAddress", ""), ("pickupCity", "Kourou"), ("minutes", "35")):
            invalid = dict(patch, **{field: value})
            self.request("PATCH", endpoint, invalid, role="restaurant", status=400)
        result = self.request("PATCH", endpoint, patch, role="restaurant")[0]["restaurant"]
        for field, value in patch.items():
            self.assertEqual(result[field], value)
        newer = self.create_order()
        self.assertEqual(newer["pickupAddress"], patch["pickupAddress"])
        self.assertEqual(newer["pickupCity"], "Matoury")
        self.assertEqual(newer["restaurant"], patch["name"])
        previous = next(row for row in self.request("GET", "/api/orders", role="client")[0]["orders"] if row["id"] == order["id"])
        for field in ("pickupAddress", "pickupCity", "restaurant"):
            self.assertEqual(previous[field], order[field])

    def test_checkout_rejects_stale_prices_versions_totals_and_legacy_payload(self):
        self.login("client")
        for field, value in (("unitPrice", 1), ("productVersion", 9999)):
            payload = self.order_payload()
            payload["items"][0][field] = value
            self.request("POST", "/api/orders", payload, role="client", status=409)
        payload = self.order_payload()
        payload["expectedTotal"] = 1
        self.request("POST", "/api/orders", payload, role="client", status=409)
        payload = self.order_payload()
        payload.pop("expectedTotal")
        payload["items"] = [{"productId": "kreol-poulet", "quantity": 1, "portion": "Classique", "sauce": "Sans piment"}]
        self.request("POST", "/api/orders", payload, role="client", status=409)
        payload = self.order_payload()
        menu = self.menu()
        menu["products"][0]["price"] += 125
        self.publish(menu)
        self.request("POST", "/api/orders", payload, role="client", status=409)
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["orders"], [])
        order = self.create_order()
        retry = self.order_payload()
        original = self.create_order(retry)
        menu = self.menu()
        menu["products"][0]["price"] += 200
        self.publish(menu)
        self.assertEqual(self.request("POST", "/api/orders", retry, role="client")[0]["order"]["id"], original["id"])
        self.assertEqual(order["items"][0]["price"], 1225)

    def test_option_constraints_reject_missing_duplicate_and_foreign_choices(self):
        self.login("client")
        _, product = self.catalog_product("kreol-poulet")
        group = next(group for group in product["optionGroups"] if group["min"] > 0)
        choice = group["choices"][0]["id"]
        for selections in ([], [{"groupId": group["id"], "choiceIds": []}],
                           [{"groupId": group["id"], "choiceIds": [choice, choice]}],
                           [{"groupId": group["id"], "choiceIds": ["foreign"]}],
                           [{"groupId": group["id"], "choiceIds": [choice]}, {"groupId": group["id"], "choiceIds": [choice]}]):
            payload = self.order_payload()
            payload["items"][0]["selections"] = selections
            self.request("POST", "/api/orders", payload, role="client", status=400)

    def test_courier_offers_are_private_and_only_assigned_orders_expose_contact(self):
        order = self.ready_order()
        self.login("courier")
        self.request("PATCH", "/api/courier/profile", {"online": False}, role="courier")
        self.assertEqual(self.request("GET", "/api/deliveries", role="courier")[0]["available"], [])
        self.request("POST", "/api/orders/" + order["id"] + "/claim", {}, role="courier", status=409)
        profile = self.online()
        self.assertIsNone(profile["activeOrderId"])
        deliveries = self.request("GET", "/api/deliveries", role="courier")[0]
        self.assertEqual(len(deliveries["available"]), 1)
        offer = deliveries["available"][0]
        self.assertEqual(set(offer), {"id", "restaurantId", "restaurant", "pickupAddress", "pickupCity", "city", "count", "status", "delivery", "date"})
        self.assertEqual(self.request("GET", "/api/orders", role="courier")[0]["orders"], [])
        assigned = self.request("POST", "/api/orders/" + order["id"] + "/claim", {}, role="courier")[0]["order"]
        self.assertEqual(assigned["address"], order["address"])
        self.assertEqual(assigned["courierId"], "demo-courier")
        self.assertNotIn("deliveryCode", assigned)
        self.assertNotIn("deliveryCode", self.request("GET", "/api/orders", role="courier")[0]["orders"][0])
        self.assertNotIn("deliveryCode", self.request("GET", "/api/orders", role="restaurant")[0]["orders"][0])
        self.login("admin")
        self.assertEqual(self.request("GET", "/api/orders", role="admin")[0]["orders"][0]["deliveryCode"], order["deliveryCode"])
        for role in ("client", "restaurant", "admin"):
            self.request("GET", "/api/deliveries", role=role, status=403)
            self.request("PATCH", "/api/courier/profile", {"online": True}, role=role, status=403)
        self.request("PATCH", "/api/courier/profile", {"online": 1}, role="courier", status=400)
        self.request("GET", "/api/couriers", role="courier", status=403)

    def test_two_couriers_cannot_claim_one_order_and_capacity_is_atomic(self):
        order = self.ready_order()
        other = self.ready_order()
        self.add_test_user("courier-other", "courier")
        self.online()
        self.online("courier-other")
        endpoint = "/api/orders/" + order["id"] + "/claim"
        results = self.concurrent([("POST", endpoint, {}, "courier"), ("POST", endpoint, {}, "courier-other")])
        self.assertEqual(sorted(status for status, _ in results), [200, 409], results)
        winner = "courier" if results[0][0] == 200 else "courier-other"
        self.request("POST", endpoint, {}, role=winner)
        self.request("POST", "/api/orders/" + other["id"] + "/claim", {}, role=winner, status=409)
        self.assertEqual(self.request("GET", "/api/deliveries", role=winner)[0]["available"], [])
        loser = "courier-other" if winner == "courier" else "courier"
        self.assertEqual(self.request("GET", "/api/orders", role=loser)[0]["orders"], [])
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "picked_up"}, role=loser, status=403)
        self.request("POST", "/api/orders/" + order["id"] + "/release", {"reason": "Test autre livreur"}, role=loser, status=403)

    def test_one_courier_cannot_claim_two_orders_concurrently(self):
        orders = [self.ready_order(), self.ready_order()]
        self.online()
        results = self.concurrent([("POST", "/api/orders/" + order["id"] + "/claim", {}, "courier") for order in orders])
        self.assertEqual(sorted(status for status, _ in results), [200, 409], results)
        assigned = self.request("GET", "/api/deliveries", role="courier")[0]["assigned"]
        self.assertEqual(len(assigned), 1)

    def test_admin_reassignment_and_courier_release_require_reason_before_pickup(self):
        order = self.ready_order()
        self.online()
        self.add_test_user("courier-other", "courier")
        self.online("courier-other")
        self.login("admin")
        endpoint = "/api/orders/" + order["id"]
        self.request("POST", endpoint + "/assign", {"courierId": "demo-courier"}, role="admin", status=400)
        self.request("POST", endpoint + "/assign", {"courierId": "demo-client", "reason": "Mauvais rôle"}, role="admin", status=400)
        self.request("POST", endpoint + "/assign", {"courierId": "demo-courier", "reason": "Affectation de test"}, role="restaurant", status=403)
        self.request("POST", endpoint + "/assign", {"courierId": "demo-courier", "reason": "Affectation de test"}, role="admin")
        self.request("POST", endpoint + "/release", {"reason": ""}, role="courier", status=400)
        released = self.request("POST", endpoint + "/release", {"reason": "Vélo indisponible"}, role="courier")[0]
        self.assertEqual(released, {"ok": True})
        self.assertEqual(self.request("GET", "/api/orders", role="courier")[0]["orders"], [])
        self.request("POST", endpoint + "/assign", {"courierId": "demo-courier", "reason": "Nouvelle affectation"}, role="admin")
        self.request("POST", endpoint + "/assign", {"courierId": "test-courier-other", "reason": "Relais avant retrait"}, role="admin")
        self.assertEqual(self.request("GET", "/api/orders", role="courier")[0]["orders"], [])
        self.request("PATCH", endpoint, {"status": "picked_up"}, role="courier-other")
        self.request("POST", endpoint + "/release", {"reason": "Trop tard"}, role="courier-other", status=409)
        self.request("POST", endpoint + "/assign", {"courierId": None, "reason": "Trop tard"}, role="admin", status=409)
        self.request("PATCH", endpoint, {"status": "cancelled", "reason": "Trop tard"}, role="admin", status=409)

    def test_role_specific_transitions_pending_cancellation_and_capacity_release(self):
        order = self.create_order()
        endpoint = "/api/orders/" + order["id"]
        self.online()
        self.login("restaurant")
        self.login("admin")
        self.request("POST", endpoint + "/claim", {}, role="courier", status=409)
        for invalid_status in (["ready"], {"status": "ready"}, None, 1):
            self.request("PATCH", endpoint, {"status": invalid_status}, role="restaurant", status=400)
        self.request("PATCH", endpoint, {"status": "cancelled"}, role="client", status=400)
        self.request("PATCH", endpoint, {"status": "cancelled", "reason": "Erreur de panier"}, role="client")
        self.request("PATCH", endpoint, {"status": "accepted"}, role="restaurant", status=409)
        order = self.create_order()
        endpoint = "/api/orders/" + order["id"]
        self.request("PATCH", endpoint, {"status": "ready"}, role="restaurant", status=409)
        self.request("PATCH", endpoint, {"status": "accepted"}, role="restaurant")
        self.request("PATCH", endpoint, {"status": "cancelled", "reason": "Après acceptation"}, role="client", status=409)
        self.request("POST", endpoint + "/claim", {}, role="courier")
        self.request("PATCH", endpoint, {"status": "picked_up"}, role="courier", status=409)
        self.request("PATCH", endpoint, {"status": "delivered", "deliveryCode": order["deliveryCode"]}, role="admin", status=403)
        self.request("PATCH", endpoint, {"status": "cancelled", "reason": "Produit épuisé"}, role="restaurant")
        profile = self.request("GET", "/api/deliveries", role="courier")[0]["profile"]
        self.assertIsNone(profile["activeOrderId"])
        history = self.request("GET", "/api/orders", role="courier")[0]["orders"]
        self.assertEqual(history[0]["status"], "cancelled")
        next_order = self.ready_order()
        self.request("POST", "/api/orders/" + next_order["id"] + "/claim", {}, role="courier")

    def test_pin_is_private_rate_limited_persistently_and_required_for_delivery(self):
        order = self.ready_order()
        self.online()
        self.login("admin")
        endpoint = "/api/orders/" + order["id"]
        self.request("POST", endpoint + "/claim", {}, role="courier")
        self.request("PATCH", endpoint, {"status": "delivered", "deliveryCode": order["deliveryCode"]}, role="courier", status=409)
        self.request("PATCH", endpoint, {"status": "picked_up"}, role="restaurant", status=403)
        self.request("PATCH", endpoint, {"status": "picked_up"}, role="courier")
        self.request("PATCH", "/api/courier/profile", {"online": False}, role="courier")
        wrong_code = "0000" if order["deliveryCode"] != "0000" else "1111"
        for _ in range(3):
            self.request("PATCH", endpoint, {"status": "delivered", "deliveryCode": wrong_code}, role="courier", status=400)
        self.reload_application()
        for _ in range(2):
            self.request("PATCH", endpoint, {"status": "delivered", "deliveryCode": wrong_code}, role="courier", status=400)
        self.request("PATCH", endpoint, {"status": "delivered", "deliveryCode": order["deliveryCode"]}, role="courier", status=429)
        current = self.request("GET", "/api/orders", role="client")[0]["orders"][0]
        self.assertEqual(current["status"], "picked_up")
        self.assertEqual(current["deliveryCode"], order["deliveryCode"])

    def test_image_upload_is_validated_owned_and_durable(self):
        self.login("restaurant")
        self.login("client")
        endpoint = "/api/restaurants/ti-kreol/images"
        self.request("POST", endpoint, {"dataUrl": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="}, role="restaurant", status=400)
        self.request("POST", endpoint, {"dataUrl": "data:image/png;base64,bm90IGFuIGltYWdl"}, role="restaurant", status=400)
        oversized = "data:image/png;base64," + base64.b64encode(b"x" * (1024 * 1024 + 1)).decode()
        self.request("POST", endpoint, {"dataUrl": oversized}, role="restaurant", status=413)
        self.request("POST", endpoint, {"dataUrl": "data:image/png;base64,eA=="}, role="client", status=403)
        self.request("POST", "/api/restaurants/smash-club/images", {"dataUrl": "data:image/png;base64,eA=="}, role="restaurant", status=403)
        # Generate a tiny original image in memory; no filesystem or remote fetch.
        import io
        from PIL import Image
        stream = io.BytesIO()
        Image.new("RGB", (3, 2), (255, 100, 30)).save(stream, format="PNG")
        payload = {"dataUrl": "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()}
        result = self.request("POST", endpoint, payload, role="restaurant", status=201)[0]
        self.assertRegex(result["url"], r"^/api/images/[A-Za-z0-9-]+$")
        self.reload_application()
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        connection.request("GET", result["url"])
        response = connection.getresponse()
        body = response.read()
        self.assertEqual(response.status, 200)
        self.assertIn(response.getheader("Content-Type"), ("image/jpeg", "image/png", "image/webp"))
        self.assertEqual(response.getheader("X-Content-Type-Options"), "nosniff")
        self.assertEqual(Image.open(io.BytesIO(body)).size, (3, 2))
        connection.close()
        menu = self.menu()
        menu["products"][0]["image"] = result["url"]
        menu = self.publish(menu)["menu"]
        self.reload_application()
        self.assertEqual(self.menu(), menu)


class MarketplaceIntegrationTests(MarketplaceContracts, test_app.AppTestHarness):
    """Run marketplace and existing regression contracts on isolated SQLite."""
