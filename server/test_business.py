"""Règles métier partagées : expiration, codes promo, estimation et saisie d'adresse."""
import copy
import http.client
import json
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from server import app, marketplace, promotions
from server.test_app import AppTestHarness


class BusinessContracts:
    def stored_order(self, order_id):
        with self.database.connect() as db:
            return json.loads(db.execute("SELECT data FROM orders WHERE id = ?", (order_id,)).fetchone()["data"])

    def set_order_fields(self, order_id, **fields):
        with self.database.connect() as db:
            self.database.begin_write(db)
            order = json.loads(db.execute("SELECT data FROM orders WHERE id = ?", (order_id,)).fetchone()["data"])
            order.update(fields)
            db.execute("UPDATE orders SET data = ? WHERE id = ?", (json.dumps(order), order_id))

    def parallel_orders(self, requests):
        barrier = threading.Barrier(len(requests))

        def send(spec):
            role, payload = spec
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
            barrier.wait(timeout=10)
            connection.request("POST", "/api/orders", json.dumps(payload),
                               {"Content-Type": "application/json", "Cookie": self.cookies[role],
                                "Origin": "http://127.0.0.1:%d" % self.port})
            response = connection.getresponse()
            result = response.status, json.loads(response.read())
            connection.close()
            return result

        with ThreadPoolExecutor(max_workers=len(requests)) as executor:
            return list(executor.map(send, requests))

    def configure_promo(self, code="BIENVENUE", **fields):
        allowed = {"kind", "value", "minimum", "starts_at", "ends_at", "max_uses", "per_customer", "active"}
        assert fields and set(fields) <= allowed
        with self.database.connect() as db:
            self.database.begin_write(db)
            db.execute("UPDATE promo_codes SET " + ", ".join(key + " = ?" for key in fields) + " WHERE code = ?",
                       tuple(fields.values()) + (code,))

    def expire(self, order_id):
        """Ramène l'échéance d'acceptation dans le passé, comme le ferait l'attente réelle."""
        with self.database.connect() as db:
            order = json.loads(db.execute("SELECT data FROM orders WHERE id = ?", (order_id,)).fetchone()["data"])
            order["acceptBy"] = "2000-01-01T00:00:00.000Z"
            db.execute("UPDATE orders SET data = ? WHERE id = ?", (json.dumps(order, ensure_ascii=False), order_id))

    def promo_payload(self, code, discount, restaurant="ti-kreol", product="kreol-poulet", customer_id="demo-client"):
        payload = self.order_payload(restaurant, product, customer_id=customer_id)
        payload["promoCode"] = code
        payload["expectedTotal"] -= discount
        return payload

    def test_unanswered_order_cancels_itself_after_the_deadline(self):
        order = self.create_order()
        self.assertGreater(order["acceptBy"], order["date"])
        self.assertIsNone(order["eta"])
        self.expire(order["id"])
        orders = self.request("GET", "/api/orders", role="client")[0]["orders"]
        expired = next(row for row in orders if row["id"] == order["id"])
        self.assertEqual(expired["status"], "cancelled")
        self.assertIn("dix minutes", expired["history"][-1]["label"])
        self.assertNotIn("actorName", expired["history"][-1])
        self.login("restaurant")
        # La commande expirée ne peut plus être acceptée, et elle quitte les offres livreur.
        self.request("PATCH", "/api/orders/%s" % order["id"], {"status": "accepted"}, role="restaurant", status=409)
        with self.database.connect() as db:
            state = db.execute("SELECT state FROM order_assignments WHERE order_id = ?", (order["id"],)).fetchone()["state"]
        self.assertEqual(state, "cancelled")

    def test_expiry_runs_inside_an_ongoing_write(self):
        """Une écriture ouvre déjà sa transaction : l'expiration ne doit pas en rouvrir une."""
        first = self.create_order()
        self.expire(first["id"])
        second = self.create_order()
        self.assertEqual(second["status"], "pending")
        orders = self.request("GET", "/api/orders", role="client")[0]["orders"]
        self.assertEqual(next(row for row in orders if row["id"] == first["id"])["status"], "cancelled")

    def test_acceptance_sets_the_estimate_and_clears_the_deadline(self):
        order = self.create_order()
        self.login("restaurant")
        accepted = self.request("PATCH", "/api/orders/%s" % order["id"], {"status": "accepted"}, role="restaurant")[0]["order"]
        self.assertIsNone(accepted["acceptBy"])
        self.assertGreater(accepted["eta"], accepted["updatedAt"])
        self.expire(order["id"])
        orders = self.request("GET", "/api/orders", role="restaurant")[0]["orders"]
        self.assertEqual(next(row for row in orders if row["id"] == order["id"])["status"], "accepted")

    def test_client_cannot_pile_up_more_than_five_running_orders(self):
        for _ in range(5):
            self.create_order()
        self.request("POST", "/api/orders", self.order_payload(), role="client", status=409)
        # Une commande terminée libère la place.
        orders = self.request("GET", "/api/orders", role="client")[0]["orders"]
        self.request("PATCH", "/api/orders/%s" % orders[0]["id"],
                     {"status": "cancelled", "reason": "Je change d’avis"}, role="client")
        self.create_order()

    def test_promotion_is_recomputed_by_the_server(self):
        self.login("client")
        restaurant, _ = self.catalog_product("kreol-poulet")
        item = self.item_payload()
        subtotal = item["unitPrice"] * item["quantity"]
        preview = self.request("POST", "/api/promotions/check",
                               {"code": "bienvenue", "restaurantId": "ti-kreol", "city": "Cayenne", "subtotal": subtotal},
                               role="client")[0]["promotion"]
        self.assertEqual(preview["code"], "BIENVENUE")
        self.assertEqual(preview["discount"], subtotal * 20 // 100)
        # Un total qui ignore la remise annoncée est refusé.
        wrong = self.order_payload()
        wrong["promoCode"] = "BIENVENUE"
        self.request("POST", "/api/orders", wrong, role="client", status=409)
        order = self.create_order(self.promo_payload("BIENVENUE", preview["discount"]))
        self.assertEqual(order["promoCode"], "BIENVENUE")
        self.assertEqual(order["discount"], preview["discount"])
        self.assertEqual(order["total"], order["subtotal"] + order["delivery"] - order["discount"])

    def test_promotion_rules_are_enforced(self):
        self.login("client")
        item = self.item_payload()
        subtotal = item["unitPrice"] * item["quantity"]
        for code, status in (("INCONNU", 404), ("TIKAZ5", 409)):
            # TIKAZ5 est réservé à Ti Kaz Kréol : il ne s'applique pas ailleurs.
            self.request("POST", "/api/promotions/check",
                         {"code": code, "restaurantId": "smash-club", "city": "Cayenne", "subtotal": subtotal},
                         role="client", status=status)
        self.request("POST", "/api/promotions/check",
                     {"code": "LIVRAISON", "restaurantId": "ti-kreol", "city": "Cayenne", "subtotal": 1000},
                     role="client", status=409)
        offered = self.request("GET", "/api/promotions")[0]["promotions"]
        self.assertEqual({row["code"] for row in offered},
                         {"BIENVENUE", "LIVRAISON", "TIKAZ5", "SMASH15", "BOWL10", "CRISPY3", "CIAO2"})
        # L'accueil calcule le prix d'appel barré : il lui faut le barème, pas seulement le libellé.
        smash = next(row for row in offered if row["code"] == "SMASH15")
        self.assertEqual((smash["kind"], smash["value"], smash["restaurantId"]), ("percent", 15, "smash-club"))
        self.assertTrue(smash["endsAt"].endswith("Z"))
        # Le prix barré de l'accueil est calculé par `lib/offers.ts` avec le barème renvoyé ici.
        # Pour chaque offre, la remise que la page annoncerait sur une commande d'un seul plat
        # doit être exactement celle que le serveur accorde — ou aucune, s'il la refuse.
        catalogue = {row["id"]: row for row in self.request("GET", "/api/restaurants")[0]["restaurants"]}
        checked = 0
        for row in offered:
            if not row["restaurantId"]:
                continue
            restaurant = catalogue[row["restaurantId"]]
            main = restaurant["categories"][0]
            cheapest = min(item["price"] for item in restaurant["products"]
                           if item["available"] and item["group"] == main)
            # Ce que `startingOffer` afficherait pour une commande de ce seul plat.
            announced = (min(cheapest * row["value"] // 100, cheapest) if row["kind"] == "percent"
                         else min(row["value"], cheapest) if row["kind"] == "amount" else 0)
            if cheapest < row["minimum"]:
                announced = 0
            accepted = cheapest >= row["minimum"]
            body, _ = self.request("POST", "/api/promotions/check",
                                   {"code": row["code"], "restaurantId": row["restaurantId"],
                                    "city": "Cayenne", "subtotal": cheapest},
                                   role="client", status=200 if accepted else 409)
            granted = body["promotion"]["discount"] if accepted and row["kind"] != "delivery" else 0
            self.assertEqual(announced, granted, row["code"])
            checked += 1
        self.assertEqual(checked, 5)
        # Chaque étiquette affichée sur l'accueil est un code que le paiement honore vraiment.
        for row in offered:
            if not row["restaurantId"]:
                continue
            self.request("POST", "/api/promotions/check",
                         {"code": row["code"], "restaurantId": row["restaurantId"],
                          "city": "Cayenne", "subtotal": max(row["minimum"], 2500)},
                         role="client")

    def test_a_code_is_consumed_once_and_released_by_a_cancellation(self):
        self.login("client")
        item = self.item_payload()
        discount = item["unitPrice"] * item["quantity"] * 20 // 100
        order = self.create_order(self.promo_payload("BIENVENUE", discount))
        self.request("POST", "/api/orders", self.promo_payload("BIENVENUE", discount), role="client", status=409)
        self.request("PATCH", "/api/orders/%s" % order["id"],
                     {"status": "cancelled", "reason": "Erreur de commande"}, role="client")
        reused = self.create_order(self.promo_payload("BIENVENUE", discount))
        self.assertEqual(reused["discount"], discount)

    def test_free_delivery_code_only_covers_the_delivery_fee(self):
        self.login("client")
        payload = self.order_payload()
        restaurant, _ = self.catalog_product("kreol-poulet")
        # Le code exige 25 € de panier : trois parts le franchissent.
        payload["items"] = [self.item_payload(quantity=3)]
        payload["expectedTotal"] = payload["items"][0]["unitPrice"] * 3 + restaurant["delivery"]
        payload["promoCode"] = "LIVRAISON"
        payload["expectedTotal"] -= restaurant["delivery"]
        order = self.create_order(payload)
        self.assertEqual(order["discount"], order["delivery"])
        self.assertEqual(order["total"], order["subtotal"])

    def test_address_directory_completes_a_street(self):
        suggestions = self.request("GET", "/api/addresses?q=7%20rue&city=Cayenne")[0]["addresses"]
        self.assertTrue(suggestions)
        self.assertTrue(all(row["label"].startswith("7 Rue") for row in suggestions))
        self.assertTrue(all(row["city"] == "Cayenne" for row in suggestions))
        self.assertEqual(self.request("GET", "/api/addresses?q=%20")[0]["addresses"], [])
        self.assertEqual(self.request("GET", "/api/addresses?q=zzzz")[0]["addresses"], [])

    def test_rejected_acceptance_commits_expiry_and_returns_the_promotion(self):
        order = self.create_order(self.promo_payload("BIENVENUE", 440))
        self.expire(order["id"])
        self.login("restaurant")
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "accepted"}, role="restaurant", status=409)
        # A GET would conceal the original bug by performing expiry again.
        persisted = self.stored_order(order["id"])
        self.assertEqual(persisted["status"], "cancelled")
        self.assertIsNone(persisted["acceptBy"])
        self.assertEqual([row["status"] for row in persisted["history"]], ["pending", "cancelled"])
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT state FROM order_assignments WHERE order_id = ?", (order["id"],)).fetchone()[0], "cancelled")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM promo_uses WHERE order_id = ?", (order["id"],)).fetchone()[0], 0)

    def test_failed_new_order_rolls_back_only_action_and_keeps_expiry(self):
        previous = self.create_order(self.promo_payload("BIENVENUE", 440))
        self.expire(previous["id"])
        payload = self.promo_payload("BIENVENUE", 440)
        actual_record = promotions.record_use

        def insert_then_fail(db, order, user):
            actual_record(db, order, user)
            raise app.APIError(409, "Conflit simulé après insertion")

        with patch("server.promotions.record_use", insert_then_fail):
            self.request("POST", "/api/orders", payload, role="client", status=409)
        self.assertEqual(self.stored_order(previous["id"])["status"], "cancelled")
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM promo_uses").fetchone()[0], 0)

    def test_promotion_preview_reclaims_expired_use_without_visiting_orders(self):
        order = self.create_order(self.promo_payload("BIENVENUE", 440))
        self.expire(order["id"])
        preview = self.request("POST", "/api/promotions/check", {"code": "BIENVENUE", "restaurantId": "ti-kreol", "city": "Cayenne", "subtotal": 2200}, role="client")[0]
        self.assertEqual(preview["promotion"]["discount"], 440)
        self.assertEqual(self.stored_order(order["id"])["status"], "cancelled")
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM promo_uses").fetchone()[0], 0)

    def test_public_promotion_list_reclaims_expired_global_quota(self):
        self.configure_promo(max_uses=1)
        order = self.create_order(self.promo_payload("BIENVENUE", 440))
        self.assertNotIn("BIENVENUE", {row["code"] for row in self.request("GET", "/api/promotions")[0]["promotions"]})
        self.expire(order["id"])
        self.assertIn("BIENVENUE", {row["code"] for row in self.request("GET", "/api/promotions")[0]["promotions"]})
        self.assertEqual(self.stored_order(order["id"])["status"], "cancelled")

    def test_promotion_window_compares_actual_instants(self):
        self.login("client")
        payload = {"code": "BIENVENUE", "restaurantId": "ti-kreol", "city": "Cayenne", "subtotal": 2200}
        self.configure_promo(starts_at="2027-05-01T14:00:00+02:00", ends_at="2027-05-01T13:00:00Z")
        with patch("server.promotions.now_iso", return_value="2027-05-01T12:00:00.500Z"):
            self.assertEqual(self.request("POST", "/api/promotions/check", payload, role="client")[0]["promotion"]["discount"], 440)
        self.configure_promo(starts_at="2027-05-01T11:00:00Z", ends_at="2027-05-01T12:00:00Z")
        with patch("server.promotions.now_iso", return_value="2027-05-01T12:00:00.000Z"):
            self.request("POST", "/api/promotions/check", payload, role="client")
        with patch("server.promotions.now_iso", return_value="2027-05-01T12:00:00.001Z"):
            self.request("POST", "/api/promotions/check", payload, role="client", status=409)
            self.assertNotIn("BIENVENUE", {row["code"] for row in self.request("GET", "/api/promotions")[0]["promotions"]})

    def test_invalid_operator_promotion_is_never_silently_free_delivery(self):
        self.login("client")
        payload = {"code": "BIENVENUE", "restaurantId": "ti-kreol", "city": "Cayenne", "subtotal": 2200}
        for fields in ({"kind": "unknown"}, {"kind": "percent", "value": 200}, {"value": 20, "max_uses": -1}):
            self.configure_promo(**fields)
            self.request("POST", "/api/promotions/check", payload, role="client", status=409)
            self.assertNotIn("BIENVENUE", {row["code"] for row in self.request("GET", "/api/promotions")[0]["promotions"]})

    def test_deadline_exact_boundary_and_timezone_are_consistent(self):
        order = self.create_order()
        self.set_order_fields(order["id"], acceptBy="2027-05-01T14:10:00+02:00")
        with patch("server.marketplace.now_iso", return_value="2027-05-01T12:09:59.999Z"):
            self.request("GET", "/api/orders", role="client")
        self.assertEqual(self.stored_order(order["id"])["status"], "pending")
        with patch("server.marketplace.now_iso", return_value="2027-05-01T12:10:00.000Z"):
            self.request("GET", "/api/orders", role="client")
        self.assertEqual(self.stored_order(order["id"])["status"], "cancelled")

    def test_legacy_null_deadline_does_not_break_order_feed(self):
        order = self.create_order()
        self.set_order_fields(order["id"], date="2020-01-01T00:00:00.000Z", acceptBy=None)
        self.request("GET", "/api/orders", role="client")
        self.assertEqual(self.stored_order(order["id"])["status"], "cancelled")

    def test_deadline_crossed_during_acceptance_cancels_and_refunds_promo(self):
        self.login("restaurant")
        for acceptance_stamp in ("2027-05-01T12:10:00.000Z", "2027-05-01T12:10:00.001Z"):
            with self.subTest(acceptance_stamp=acceptance_stamp):
                order = self.create_order(self.promo_payload("BIENVENUE", 440))
                self.set_order_fields(order["id"], acceptBy="2027-05-01T12:10:00.000Z")
                with patch("server.marketplace.now_iso", side_effect=["2027-05-01T12:09:59.999Z", acceptance_stamp]):
                    self.request("PATCH", "/api/orders/" + order["id"], {"status": "accepted"}, role="restaurant", status=409)
                # Read storage directly: another HTTP read must not conceal a
                # cancellation rolled back with the failed acceptance action.
                persisted = self.stored_order(order["id"])
                self.assertEqual(persisted["status"], "cancelled")
                self.assertEqual(persisted["updatedAt"], acceptance_stamp)
                self.assertIsNone(persisted["eta"])
                self.assertIsNone(persisted["acceptBy"])
                self.assertEqual([event["status"] for event in persisted["history"]], ["pending", "cancelled"])
                with self.database.connect() as db:
                    self.assertEqual(db.execute("SELECT state FROM order_assignments WHERE order_id = ?", (order["id"],)).fetchone()[0], "cancelled")
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM promo_uses WHERE order_id = ?", (order["id"],)).fetchone()[0], 0)

    def test_accepted_order_restart_never_restores_acceptance_deadline(self):
        order = self.create_order()
        self.login("restaurant")
        accepted = self.request("PATCH", "/api/orders/" + order["id"], {"status": "accepted"}, role="restaurant")[0]["order"]
        self.assertEqual(accepted["eta"], marketplace.shifted(accepted["updatedAt"], 40 * 60))
        self.set_order_fields(order["id"], acceptBy=order["acceptBy"])
        self.database.initialize()
        persisted = self.stored_order(order["id"])
        self.assertIsNone(persisted["acceptBy"])
        self.assertEqual(persisted["eta"], accepted["eta"])
        self.assertEqual(persisted["items"], order["items"])

    def test_client_capacity_is_atomic_under_concurrent_checkout(self):
        for _ in range(4):
            self.create_order()
        payloads = [self.order_payload(), self.order_payload()]
        results = self.parallel_orders([("client", payload) for payload in payloads])
        self.assertEqual(sorted(status for status, _ in results), [201, 409])
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM order_assignments WHERE state = 'pending'").fetchone()[0], 5)

    def test_per_account_promotion_quota_is_atomic(self):
        self.login("client")
        results = self.parallel_orders([("client", self.promo_payload("BIENVENUE", 440)), ("client", self.promo_payload("BIENVENUE", 440))])
        self.assertEqual(sorted(status for status, _ in results), [201, 409])
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM promo_uses WHERE code = 'BIENVENUE'").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 1)

    def test_global_promotion_quota_is_atomic_between_customers(self):
        self.configure_promo(max_uses=1, per_customer=0)
        self.login("client")
        self.add_test_user("client2", "client")
        self.login("client2")
        results = self.parallel_orders([("client", self.promo_payload("BIENVENUE", 440)), ("client2", self.promo_payload("BIENVENUE", 440, customer_id="test-client2"))])
        self.assertEqual(sorted(status for status, _ in results), [201, 409])
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM promo_uses WHERE code = 'BIENVENUE'").fetchone()[0], 1)

    def test_replay_at_capacity_never_consumes_promo_twice_or_revives_cancelled_use(self):
        payload = self.promo_payload("BIENVENUE", 440)
        original = self.create_order(payload)
        for _ in range(4):
            self.create_order()
        replay = self.request("POST", "/api/orders", payload, role="client")[0]["order"]
        self.assertEqual(replay["id"], original["id"])
        self.request("PATCH", "/api/orders/" + original["id"], {"status": "cancelled", "reason": "Annulation de test"}, role="client")
        replay = self.request("POST", "/api/orders", payload, role="client")[0]["order"]
        self.assertEqual(replay["status"], "cancelled")
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 5)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM promo_uses").fetchone()[0], 0)
        self.create_order(self.promo_payload("BIENVENUE", 440))

    def test_request_uuid_case_is_idempotent_for_new_and_legacy_orders(self):
        payload = self.order_payload()
        payload["requestId"] = "abcdabcd-1234-4abc-a123-abcdabcdabcd"
        original = self.create_order(payload)
        upper = copy.deepcopy(payload)
        upper["requestId"] = payload["requestId"].upper()
        self.assertEqual(self.request("POST", "/api/orders", upper, role="client")[0]["order"]["id"], original["id"])
        with self.database.connect() as db:
            self.database.begin_write(db)
            db.execute("UPDATE orders SET request_id = ? WHERE id = ?", (upper["requestId"], original["id"]))
        self.assertEqual(self.request("POST", "/api/orders", payload, role="client")[0]["order"]["id"], original["id"])
        upper["notes"] += " autre contenu"
        self.request("POST", "/api/orders", upper, role="client", status=409)
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 1)

    def test_order_phone_is_open_only_during_staff_contact_window(self):
        order = self.create_order()
        self.login("restaurant")
        self.login("courier")
        self.login("admin")
        self.assertEqual(self.request("GET", "/api/orders", role="restaurant")[0]["orders"][0]["phone"], "")
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "accepted"}, role="restaurant")
        self.assertEqual(self.request("GET", "/api/orders", role="restaurant")[0]["orders"][0]["phone"], order["phone"])
        self.request("PATCH", "/api/courier/profile", {"online": True}, role="courier")
        self.request("POST", "/api/orders/" + order["id"] + "/claim", {}, role="courier")
        self.assertEqual(self.request("GET", "/api/orders", role="courier")[0]["orders"][0]["phone"], order["phone"])
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "cancelled", "reason": "Annulation de démonstration"}, role="admin")
        for role in ("restaurant", "courier"):
            self.assertEqual(self.request("GET", "/api/orders", role=role)[0]["orders"][0]["phone"], "")
        delivery_feed = self.request("GET", "/api/deliveries", role="courier")[0]
        self.assertEqual(delivery_feed["assigned"][0]["phone"], "")
        self.assertIsInstance(delivery_feed["unread"], dict)
        for role in ("client", "admin"):
            self.assertEqual(self.request("GET", "/api/orders", role=role)[0]["orders"][0]["phone"], order["phone"])


class BusinessRuleTests(BusinessContracts, AppTestHarness):
    """Business invariants with temporary SQLite databases."""


@unittest.skipUnless(os.environ.get("MANJEO_TEST_DATABASE_URL"), "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresBusinessRuleTests(BusinessContracts, AppTestHarness):
    """Same HTTP invariants in disposable schemas of an explicit test database."""
    from server.test_postgres import PostgresIntegrationTests as _Harness
    setUp = _Harness.setUp
    tearDown = _Harness.tearDown
    close_server = _Harness.close_server
    drop_owned_schema = _Harness.drop_owned_schema

    def test_statement_timeout_preserves_database_error_and_rolls_back_action(self):
        order = self.create_order()
        original_api = app.Handler.api

        def interrupted_action(handler, db, path, data):
            if path == "/api/orders":
                db.execute("UPDATE orders SET request_hash = ? WHERE id = ?", ("uncommitted", order["id"]))
                db.execute("SET LOCAL statement_timeout = '1ms'")
                db.execute("SELECT pg_sleep(0.02)")
            return original_api(handler, db, path, data)

        with self.database.connect() as db:
            original_hash = db.execute("SELECT request_hash FROM orders WHERE id = ?", (order["id"],)).fetchone()[0]
        with patch.object(app.Handler, "api", interrupted_action):
            response = self.request("GET", "/api/orders", role="client", status=503)[0]
        self.assertIn("momentanément indisponible", response["error"])
        self.assertEqual(self.stored_order(order["id"]), order)
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT request_hash FROM orders WHERE id = ?", (order["id"],)).fetchone()[0], original_hash)


if __name__ == "__main__":
    unittest.main()
