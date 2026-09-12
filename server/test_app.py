"""HTTP integration coverage using isolated temporary SQLite databases."""
import copy
import hashlib
import http.client
import json
import secrets
import tempfile
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from server.app import COOKIE_NAME, Database, Handler, ManjeoServer, password_digest


class AppTestHarness(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = Database(Path(self.directory.name) / "demo.sqlite3")
        static = Path(self.directory.name) / "dist"
        static.mkdir()
        (static / "index.html").write_text("<html>Manjéo test</html>")
        self.server = ManjeoServer(("127.0.0.1", 0), self.database, static)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()
        self.port = self.server.server_port
        self.cookies = {}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, method, path, data=None, role=None, status=200, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        request_headers = {"Origin": "http://127.0.0.1:%d" % self.port}
        if data is not None:
            request_headers["Content-Type"] = "application/json"
        if role:
            request_headers["Cookie"] = self.cookies.get(role, "")
        request_headers.update(headers or {})
        connection.request(method, path, json.dumps(data) if data is not None else None, request_headers)
        response = connection.getresponse()
        body = response.read()
        self.assertEqual(response.status, status, body.decode())
        payload = json.loads(body) if response.getheader("Content-Type", "").startswith("application/json") else body.decode()
        result = (payload, dict(response.getheaders()))
        connection.close()
        return result

    def login(self, role):
        response, headers = self.request("POST", "/api/login", {"email": ("livreur" if role == "courier" else role) + "@manjeo.test", "password": "ManjeoDemo2026!"})
        self.cookies[role] = headers["Set-Cookie"].split(";", 1)[0]
        return response, headers

    def catalog_product(self, product_id, restaurant_id="ti-kreol"):
        catalog = self.request("GET", "/api/restaurants")[0]["restaurants"]
        restaurant = next(row for row in catalog if row["id"] == restaurant_id)
        return restaurant, next(product for product in restaurant["products"] if product["id"] == product_id)

    def item_payload(self, product_id="kreol-poulet", restaurant_id="ti-kreol", quantity=2):
        _, product = self.catalog_product(product_id, restaurant_id)
        selections = []
        price = product["price"]
        for group in product["optionGroups"]:
            chosen = group["choices"][:group["min"]]
            if chosen:
                selections.append({"groupId": group["id"], "choiceIds": [choice["id"] for choice in chosen]})
                price += sum(choice["price"] for choice in chosen)
        return {"productId": product_id, "quantity": quantity, "selections": selections,
                "unitPrice": price, "productVersion": product["version"]}

    def order_payload(self, restaurant="ti-kreol", product="kreol-poulet"):
        restaurant_row, _ = self.catalog_product(product, restaurant)
        item = self.item_payload(product, restaurant)
        return {
            "restaurantId": restaurant, "items": [item],
            "expectedTotal": item["unitPrice"] * item["quantity"] + restaurant_row["delivery"],
            "customerName": "Camille Test", "phone": "0694 00 00 00",
            "address": "12 rue de la Démonstration", "city": "Cayenne",
            "details": "Portail bleu", "notes": "Commande test", "requestId": str(uuid.uuid4()),
        }

    def create_order(self, payload=None, role="client"):
        if role not in self.cookies:
            self.login(role)
        return self.request("POST", "/api/orders", payload or self.order_payload(), role=role, status=201)[0]["order"]

    def add_test_user(self, email, role, restaurant=None):
        salt = secrets.token_hex(16)
        with self.database.connect() as db:
            db.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)", ("test-" + email, email + "@manjeo.test", "Autre compte", role, restaurant, salt, password_digest("ManjeoDemo2026!", salt)))


class AppIntegrationTests(AppTestHarness):
    def test_catalog_and_safe_seed(self):
        catalog, _ = self.request("GET", "/api/restaurants")
        self.assertEqual(len(catalog["restaurants"]), 6)
        self.assertEqual(sum(len(row["products"]) for row in catalog["restaurants"]), 24)
        self.assertTrue(all(row["acceptingOrders"] for row in catalog["restaurants"]))
        self.assertEqual(self.request("GET", "/api/session")[0], {"user": None})
        with self.database.connect() as db:
            users = db.execute("SELECT * FROM users").fetchall()
            self.assertEqual(len(users), 4)
            self.assertEqual(len({row["password_salt"] for row in users}), 4)
            self.assertTrue(all(row["password_hash"] != "ManjeoDemo2026!" for row in users))

    def test_login_cookie_session_logout_and_expiry(self):
        self.request("POST", "/api/login", {"email": "client@manjeo.test", "password": "wrong"}, status=401)
        response, headers = self.login("client")
        self.assertEqual(response["user"]["role"], "client")
        self.assertNotIn("password_hash", response["user"])
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        self.assertIn("SameSite=Strict", headers["Set-Cookie"])
        token = self.cookies["client"].split("=", 1)[1]
        with self.database.connect() as db:
            stored = db.execute("SELECT token_hash FROM sessions").fetchone()[0]
        self.assertEqual(stored, hashlib.sha256(token.encode()).hexdigest())
        self.assertEqual(self.request("GET", "/api/session", role="client")[0]["user"]["email"], "client@manjeo.test")
        self.request("POST", "/api/logout", {}, role="client")
        self.request("GET", "/api/orders", role="client", status=401)
        self.login("client")
        with self.database.connect() as db:
            db.execute("UPDATE sessions SET expires_at = ?", (int(time.time()) - 1,))
        self.assertIsNone(self.request("GET", "/api/session", role="client")[0]["user"])

    def test_role_permissions_and_user_listing(self):
        self.request("GET", "/api/orders", status=401)
        self.request("GET", "/api/users", status=401)
        for role in ("client", "restaurant", "admin", "courier"):
            self.login(role)
        self.request("GET", "/api/users", role="client", status=403)
        self.request("GET", "/api/users", role="restaurant", status=403)
        self.request("GET", "/api/users", role="courier", status=403)
        users = self.request("GET", "/api/users", role="admin")[0]["users"]
        self.assertEqual(len(users), 4)
        # L’admin voit les coordonnées de supervision ; jamais le sel ni l’empreinte du mot de passe.
        self.assertEqual(set(users[0]), {"id", "email", "name", "role", "restaurantId", "phone", "language"})
        for role in ("admin", "restaurant", "courier"):
            self.request("POST", "/api/orders", self.order_payload(), role=role, status=403)
        self.request("PATCH", "/api/restaurants/ti-kreol", {"acceptingOrders": False}, role="client", status=403)

    def test_server_totals_options_and_customer_identity(self):
        payload = self.order_payload()
        _, product = self.catalog_product("kreol-poulet")
        selections = []
        unit_price = product["price"]
        for group in product["optionGroups"]:
            preferred = next((choice for choice in group["choices"] if choice["name"] in ("Gros appétit", "Piment à part")), group["choices"][0])
            selections.append({"groupId": group["id"], "choiceIds": [preferred["id"]]})
            unit_price += preferred["price"]
        payload["items"][0].update(selections=selections, unitPrice=unit_price, price=1)
        payload["items"].append(self.item_payload("kreol-jus", quantity=1))
        payload.update(city="Matoury", total=1, delivery=0, customerId="demo-admin", status="delivered", expectedTotal=3300)
        order = self.create_order(payload)
        self.assertEqual(order["subtotal"], 2950)
        self.assertEqual(order["delivery"], 350)
        self.assertEqual(order["total"], 3300)
        self.assertEqual(order["count"], 3)
        self.assertEqual(order["customerId"], "demo-client")
        self.assertEqual(order["status"], "pending")
        self.assertEqual(order["items"][0]["price"], 1300)
        self.assertEqual(order["history"][0]["status"], "pending")
        self.assertRegex(order["deliveryCode"], r"^[0-9]{4}$")

    def test_invalid_items_and_delivery_fields_are_rejected(self):
        self.login("client")
        invalid = []
        for quantity in (0, -1, 21, 1.5, True, "2"):
            payload = self.order_payload()
            payload["items"][0]["quantity"] = quantity
            invalid.append(payload)
        for selection in ([{"groupId": "foreign-group", "choiceIds": ["foreign-choice"]}],
                          [{"groupId": "foreign-group", "choiceIds": ["x", "x"]}], "invalid"):
            payload = self.order_payload()
            payload["items"][0]["selections"] = selection
            invalid.append(payload)
        foreign_product = self.order_payload()
        foreign_product["items"][0]["productId"] = "smash-classic"
        invalid.append(foreign_product)
        for field, value in [("city", "Kourou"), ("customerName", "A"), ("phone", "invalid"), ("address", "123"), ("requestId", "not-a-uuid"), ("notes", "x" * 501), ("items", [])]:
            payload = self.order_payload()
            payload[field] = value
            invalid.append(payload)
        duplicate = self.order_payload()
        duplicate["items"] *= 2
        invalid.append(duplicate)
        for payload in invalid:
            with self.subTest(payload=payload):
                self.request("POST", "/api/orders", payload, role="client", status=400)
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["orders"], [])

    def test_order_visibility_and_restaurant_ownership(self):
        first = self.create_order()
        second = self.create_order(self.order_payload("smash-club", "smash-classic"))
        self.add_test_user("other", "client")
        self.login("other")
        other = self.create_order(role="other")
        self.login("restaurant")
        self.login("admin")
        self.assertEqual({order["id"] for order in self.request("GET", "/api/orders", role="client")[0]["orders"]}, {first["id"], second["id"]})
        self.assertEqual({order["id"] for order in self.request("GET", "/api/orders", role="other")[0]["orders"]}, {other["id"]})
        self.assertEqual({order["id"] for order in self.request("GET", "/api/orders", role="restaurant")[0]["orders"]}, {first["id"], other["id"]})
        self.assertEqual(len(self.request("GET", "/api/orders", role="admin")[0]["orders"]), 3)
        self.request("PATCH", "/api/orders/" + second["id"], {"status": "accepted"}, role="restaurant", status=403)
        self.request("PATCH", "/api/orders/" + first["id"], {"status": "accepted"}, role="client", status=403)

    def test_complete_status_lifecycle_and_terminal_states(self):
        order = self.create_order()
        delivery_code = order["deliveryCode"]
        self.login("restaurant")
        self.login("admin")
        self.login("courier")
        endpoint = "/api/orders/" + order["id"]
        self.request("PATCH", endpoint, {"status": "delivered"}, role="restaurant", status=403)
        for status in ("accepted", "preparing", "ready"):
            order = self.request("PATCH", endpoint, {"status": status}, role="restaurant")[0]["order"]
            self.assertEqual(order["status"], status)
        self.request("PATCH", "/api/courier/profile", {"online": True}, role="courier")
        self.request("POST", endpoint + "/claim", {}, role="courier")
        self.request("PATCH", endpoint, {"status": "picked_up"}, role="courier")
        order = self.request("PATCH", endpoint, {"status": "delivered", "deliveryCode": delivery_code}, role="courier")[0]["order"]
        self.assertEqual(order["status"], "delivered")
        statuses = [event["status"] for index, event in enumerate(order["history"])
                    if index == 0 or event["status"] != order["history"][index - 1]["status"]]
        self.assertEqual(statuses, ["pending", "accepted", "preparing", "ready", "picked_up", "delivered"])
        self.request("PATCH", endpoint, {"status": "cancelled", "reason": "Commande terminée"}, role="admin", status=409)
        cancelled = self.create_order()
        endpoint = "/api/orders/" + cancelled["id"]
        self.request("PATCH", endpoint, {"status": "cancelled", "reason": "Incident de démonstration"}, role="admin")
        self.request("PATCH", endpoint, {"status": "accepted"}, role="restaurant", status=409)

    def test_product_and_restaurant_controls_enforced_on_orders(self):
        self.login("client")
        self.login("restaurant")
        self.login("admin")
        self.request("PATCH", "/api/restaurants/smash-club", {"acceptingOrders": False}, role="restaurant", status=403)
        self.request("PATCH", "/api/restaurants/ti-kreol/products/smash-classic", {"available": False}, role="restaurant", status=404)
        self.request("PATCH", "/api/restaurants/ti-kreol", {"acceptingOrders": 0}, role="restaurant", status=400)
        self.request("PATCH", "/api/restaurants/ti-kreol/products/kreol-poulet", {"available": False}, role="restaurant")
        self.request("POST", "/api/orders", self.order_payload(), role="client", status=409)
        catalog = self.request("GET", "/api/restaurants")[0]["restaurants"]
        self.assertFalse(catalog[0]["products"][0]["available"])
        self.request("PATCH", "/api/restaurants/ti-kreol/products/kreol-poulet", {"available": True}, role="restaurant")
        self.request("PATCH", "/api/restaurants/ti-kreol", {"acceptingOrders": False}, role="restaurant")
        self.request("POST", "/api/orders", self.order_payload(), role="client", status=409)
        self.request("PATCH", "/api/restaurants/ti-kreol", {"acceptingOrders": True}, role="admin")
        self.create_order()

    def test_idempotency_concurrency_conflict_and_persistence(self):
        self.login("client")
        payload = self.order_payload()
        def send_order():
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
            connection.request("POST", "/api/orders", json.dumps(payload), {"Content-Type": "application/json", "Cookie": self.cookies["client"]})
            response = connection.getresponse()
            result = response.status, json.loads(response.read())
            connection.close()
            return result
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: send_order(), range(2)))
        self.assertEqual(sorted(status for status, _ in results), [200, 201])
        self.assertEqual(results[0][1]["order"]["id"], results[1][1]["order"]["id"])
        modified = copy.deepcopy(payload)
        modified["notes"] = "Autre contenu"
        self.request("POST", "/api/orders", modified, role="client", status=409)
        self.login("restaurant")
        self.request("PATCH", "/api/restaurants/ti-kreol", {"acceptingOrders": False}, role="restaurant")
        # Retrying the original request after a restaurant closes still yields the existing order.
        self.request("POST", "/api/orders", payload, role="client")
        reloaded = Database(self.database.path)
        with reloaded.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT accepting_orders FROM restaurants WHERE id = 'ti-kreol'").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 4)

    def test_origin_content_type_and_static_boundaries(self):
        payload = {"email": "client@manjeo.test", "password": "ManjeoDemo2026!"}
        self.request("POST", "/api/login", payload, headers={"Origin": "https://evil.example"}, status=403)
        self.request("POST", "/api/login", payload, headers={"Sec-Fetch-Site": "cross-site"}, status=403)
        self.request("POST", "/api/login", payload, headers={"Content-Type": "text/plain"}, status=415)
        self.request("GET", "/api/session", headers={"Host": "evil.example"}, status=403)
        self.request("OPTIONS", "/api/orders", status=403)
        self.assertIn("Manjéo test", self.request("GET", "/restaurant/dashboard")[0])
        self.request("GET", "/%2e%2e/demo.sqlite3", status=404)
        self.request("GET", "/api/missing", status=404)


if __name__ == "__main__":
    unittest.main()
