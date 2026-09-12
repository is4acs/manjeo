"""Displayed-account assertions over HTTP; SQLite and isolated PostgreSQL only."""
import hashlib
import json
import os
import unittest
from unittest.mock import patch

from server import customer, payments, translation
from server.test_app import AppTestHarness


class SessionContextContracts:
    def setup_context(self):
        for role in ("client", "restaurant", "admin", "courier"):
            self.login(role)
        self.add_test_user("second-client", "client")
        self.login("second-client")
        self.environment = patch.dict(os.environ, {
            "MANJEO_PAYMENT_MODE": "stripe_test", "STRIPE_SECRET_KEY": "sk_test_FixtureOnly",
            "STRIPE_WEBHOOK_SECRET": "whsec_FixtureOnly", "APP_ORIGIN": "https://payments.example.test",
            "MANJEO_TRANSLATE_PROVIDER": "vercel", "VERCEL_OIDC_TOKEN": "fixture-only",
            "AI_GATEWAY_API_KEY": "", "MANJEO_TRANSLATE_URL": "https://translation.example.test",
        })
        self.environment.start(); self.addCleanup(self.environment.stop)
        self.providers = {}
        for module, name in ((customer, "geocode"), (payments, "stripe_request"),
                             (translation, "gateway_translate"), (translation, "relay_translate")):
            mocked = patch.object(module, name, side_effect=AssertionError("Unexpected provider call"))
            self.providers[name] = mocked.start(); self.addCleanup(mocked.stop)

    def context(self, user_id="demo-client"):
        return {"X-Manjeo-Account": user_id}

    def mismatch(self, method, path, body=None, role="client", expected="another-account"):
        response = self.request(method, path, body, role=role, status=409, headers=self.context(expected))[0]
        self.assertEqual(response, {"error": "Le compte connecté a changé. Réessayez.", "code": "session_changed"})
        return response

    def snapshot(self):
        tables = ("users", "sessions", "user_profiles", "customer_addresses", "customer_preferences", "restaurants", "products",
                  "orders", "order_assignments", "courier_profiles", "promo_uses", "order_messages", "order_message_reads",
                  "order_message_receipts", "order_message_requests", "address_verifications", "address_verification_usage",
                  "translation_usage", "translation_cache", "order_payments")
        with self.database.connect() as db:
            return {table: hashlib.sha256(json.dumps(sorted(json.dumps(dict(row), sort_keys=True) for row in
                    db.execute("SELECT * FROM " + table)), sort_keys=True).encode()).hexdigest() for table in tables}

    def revoke(self, role):
        token = self.cookies[role].split("=", 1)[1]
        with self.database.connect() as db:
            self.database.begin_write(db)
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))

    def test_header_cannot_authenticate_and_session_refresh_is_unbound(self):
        self.request("GET", "/api/orders", status=401, headers=self.context())
        self.assertEqual(self.request("GET", "/api/session", role="second-client", headers=self.context())[0]["user"]["id"], "test-second-client")
        self.assertIsNone(self.request("GET", "/api/session", headers=self.context())[0]["user"])
        for role in ("client", "restaurant", "admin", "courier"):
            expected = "demo-" + role
            self.assertEqual(self.request("GET", "/api/profile", role=role, headers=self.context(expected))[0]["user"]["id"], expected)
        # Public routes and the historical no-header API remain usable.
        for path in ("/api/restaurants", "/api/promotions", "/api/phrases", "/api/payments/config"):
            self.request("GET", path, headers=self.context())
        self.request("PATCH", "/api/profile", {"name": "Sans en-tête"}, role="client")
        self.request("POST", "/api/logout", {}, role="client", headers=self.context())
        self.assertIsNone(self.request("GET", "/api/session", role="client")[0]["user"])

    def test_mismatch_rejects_all_authenticated_routes_before_any_side_effect(self):
        payload = self.order_payload()
        order = self.create_order(payload)
        path = "/api/orders/" + order["id"]
        menu = self.request("GET", "/api/restaurants/ti-kreol/menu", role="restaurant")[0]["menu"]
        routes = [
            ("GET", "/api/profile", None, "client"), ("PATCH", "/api/profile", {"name": "Wrong person"}, "client"),
            ("GET", "/api/users", None, "admin"), ("GET", "/api/orders", None, "client"),
            ("POST", "/api/orders", payload, "client"), ("PATCH", path, {"status": "accepted"}, "restaurant"),
            ("POST", path + "/claim", {}, "courier"), ("POST", path + "/release", {"reason": "Wrong person"}, "courier"),
            ("POST", path + "/assign", {"courierId": "demo-courier", "reason": "Wrong person"}, "admin"),
            ("GET", path + "/thread", None, "client"), ("POST", path + "/messages", {"body": "Wrong person"}, "client"),
            ("GET", "/api/deliveries", None, "courier"), ("GET", "/api/couriers", None, "admin"),
            ("PATCH", "/api/courier/profile", {"online": True}, "courier"),
            ("GET", "/api/restaurants/ti-kreol/menu", None, "restaurant"),
            ("PATCH", "/api/restaurants/ti-kreol/menu", menu, "restaurant"),
            ("POST", "/api/restaurants/ti-kreol/images", {}, "restaurant"),
            ("PATCH", "/api/restaurants/ti-kreol/products/kreol-poulet", {"available": False}, "restaurant"),
            ("PATCH", "/api/restaurants/ti-kreol", {"acceptingOrders": False}, "restaurant"),
            ("POST", "/api/promotions/check", {"code": "BIENVENUE"}, "client"),
            ("POST", "/api/addresses/verify", {"address": "7 Rue Lallouette", "city": "Cayenne"}, "client"),
            ("POST", "/api/translate", {"orderId": order["id"], "messageId": "missing", "to": "ht"}, "client"),
            ("POST", "/api/translate", {"text": "Bonjour", "from": "fr", "to": "ht"}, "client"),
            ("POST", path + "/checkout", {}, "client"), ("POST", path + "/refund", {}, "admin"),
            ("POST", "/api/logout", {}, "client"),
        ]
        # A mismatch must not even run the otherwise-independent expiry sweep.
        with self.database.connect() as db:
            self.database.begin_write(db)
            order["acceptBy"] = "2000-01-01T00:00:00.000Z"
            db.execute("UPDATE orders SET data=? WHERE id=?", (json.dumps(order), order["id"]))
        before = self.snapshot()
        for method, endpoint, body, role in routes:
            with self.subTest(method=method, endpoint=endpoint):
                self.mismatch(method, endpoint, body, role)
                self.assertEqual(self.snapshot(), before)
        for provider in self.providers.values():
            provider.assert_not_called()
        # Account mismatch takes precedence even when the new cookie has another role.
        self.mismatch("POST", "/api/orders", payload, "restaurant", "demo-client")

    def test_uncertain_order_replay_under_other_cookie_keeps_original_key_recoverable(self):
        payload = self.order_payload()
        created = self.request("POST", "/api/orders", payload, role="client", status=201, headers=self.context())[0]["order"]
        # Treat the first response as lost, then retry with the other tab's cookie.
        self.mismatch("POST", "/api/orders", payload, "second-client", "demo-client")
        recovered = self.request("POST", "/api/orders", payload, role="client", headers=self.context())[0]["order"]
        self.assertEqual(recovered, created)
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 1)
        # Even an otherwise valid new order for cookie B cannot execute from UI A.
        second = self.order_payload(customer_id="test-second-client")
        self.mismatch("POST", "/api/orders", second, "second-client", "demo-client")
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 1)

    def test_address_rechecks_session_after_lock_wait_and_after_provider(self):
        original = self.database.begin_write
        first = True
        def lock_after_revocation(db):
            nonlocal first
            if first:
                first = False
                self.revoke("client")
            original(db)
        body = {"address": "7 Rue Lallouette", "city": "Cayenne"}
        with patch.object(self.database, "begin_write", side_effect=lock_after_revocation):
            self.request("POST", "/api/addresses/verify", body, role="client", status=401, headers=self.context())
        self.providers["geocode"].assert_not_called()
        self.login("client")
        def revoked_provider(*args):
            self.revoke("client")
            return {"source": "ign", "candidates": [{"address": "7 Rue Lallouette", "city": "Cayenne", "latitude": 4.939915,
                    "longitude": -52.332754, "provider": "ign", "precision": "house"}]}
        self.providers["geocode"].side_effect = revoked_provider
        self.request("POST", "/api/addresses/verify", body, role="client", status=401, headers=self.context())
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM address_verifications").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM address_verification_usage").fetchone()[0], 1)

    def test_modern_and_legacy_translation_recheck_session_after_provider(self):
        order = self.create_order()
        path = "/api/orders/" + order["id"]
        self.request("PATCH", path, {"status": "accepted"}, role="restaurant")
        message = self.request("POST", path + "/messages", {"body": "Estou aqui."}, role="client", status=201)[0]["message"]
        def revoke_gateway(*args):
            self.revoke("restaurant")
            return "Mwen la.", "pt"
        self.providers["gateway_translate"].side_effect = revoke_gateway
        self.request("POST", "/api/translate", {"orderId": order["id"], "messageId": message["id"], "to": "ht"},
                     role="restaurant", status=401, headers=self.context("demo-restaurant"))
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM translation_cache").fetchone()[0], 0)
        def revoke_relay(*args):
            self.revoke("client")
            return "Mwen la."
        self.providers["relay_translate"].side_effect = revoke_relay
        self.request("POST", "/api/translate", {"text": "Estou aqui.", "from": "pt", "to": "ht"},
                     role="client", status=401, headers=self.context())

    def test_legacy_translation_rechecks_session_before_quota_after_lock_wait(self):
        original = self.database.begin_write
        first = True
        def lock_after_revocation(db):
            nonlocal first
            if first:
                first = False
                self.revoke("client")
            original(db)
        with patch.object(self.database, "begin_write", side_effect=lock_after_revocation):
            self.request("POST", "/api/translate", {"text": "Bonjour", "from": "fr", "to": "ht"},
                         role="client", status=401, headers=self.context())
        self.providers["relay_translate"].assert_not_called()
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM translation_usage").fetchone()[0], 0)

    def test_payment_checkout_and_refund_recheck_session_after_provider(self):
        payload = self.order_payload()
        payload["paymentMethod"] = "stripe"
        order = self.create_order(payload)
        path = "/api/orders/" + order["id"]
        with self.database.connect() as db:
            row = dict(db.execute("SELECT * FROM order_payments WHERE order_id=?", (order["id"],)).fetchone())
        def revoked_checkout(*args):
            self.revoke("client")
            return {"id": "cs_test_" + row["payment_id"], "object": "checkout.session", "livemode": False,
                    "mode": "payment", "amount_total": row["amount"], "currency": "eur", "client_reference_id": order["id"],
                    "metadata": payments.metadata(row), "status": "open", "url": "https://checkout.stripe.com/c/pay/test"}
        self.providers["stripe_request"].side_effect = revoked_checkout
        self.request("POST", path + "/checkout", {}, role="client", status=401, headers=self.context())
        with self.database.connect() as db:
            current = db.execute("SELECT * FROM order_payments WHERE order_id=?", (order["id"],)).fetchone()
            self.assertFalse(current["session_id"])
            self.assertFalse(current["checkout_url"])
            self.database.begin_write(db)
            order["status"] = "cancelled"
            order["payment"]["status"] = "refund_pending"
            db.execute("UPDATE orders SET data=? WHERE id=?", (json.dumps(order), order["id"]))
            db.execute("UPDATE order_payments SET status='refund_pending', payment_intent_id='pi_fixture' WHERE order_id=?", (order["id"],))
        def revoked_refund(*args):
            self.revoke("admin")
            return {"id": "re_fixture", "object": "refund", "livemode": False, "payment_intent": "pi_fixture",
                    "metadata": payments.metadata(row), "amount": row["amount"], "currency": "eur"}
        self.providers["stripe_request"].side_effect = revoked_refund
        self.request("POST", path + "/refund", {}, role="admin", status=401, headers=self.context("demo-admin"))
        with self.database.connect() as db:
            self.assertFalse(db.execute("SELECT refund_id FROM order_payments WHERE order_id=?", (order["id"],)).fetchone()[0])


class SessionContextTests(SessionContextContracts, AppTestHarness):
    def setUp(self):
        super().setUp()
        self.setup_context()


@unittest.skipUnless(os.environ.get("MANJEO_TEST_DATABASE_URL"), "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresSessionContextTests(SessionContextContracts, AppTestHarness):
    from server.test_postgres import PostgresIntegrationTests as _Harness
    def setUp(self):
        self._Harness.setUp(self)
        self.setup_context()
    tearDown = _Harness.tearDown
    close_server = _Harness.close_server
    drop_owned_schema = _Harness.drop_owned_schema
