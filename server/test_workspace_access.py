"""Role-specific entry points over HTTP, using a disposable SQLite database."""
import hashlib
import json
import time
from unittest.mock import patch

from server import customer, payments
from server.test_app import AppTestHarness


class WorkspaceAccessTests(AppTestHarness):
    def setUp(self):
        super().setUp()
        for role in ("client", "restaurant", "courier", "admin"):
            self.login(role)

    def snapshot(self):
        tables = ("users", "sessions", "user_profiles", "customer_addresses", "customer_preferences",
                  "restaurants", "products", "menu_images", "orders", "order_assignments",
                  "courier_profiles", "promo_uses", "address_verifications", "address_verification_usage",
                  "order_payments")
        with self.database.connect() as db:
            return {table: hashlib.sha256(json.dumps(sorted(json.dumps(dict(row), sort_keys=True)
                    for row in db.execute("SELECT * FROM " + table))).encode()).hexdigest() for table in tables}

    def test_storefront_is_public_or_client_only_without_changing_data(self):
        expected = self.request("GET", "/api/restaurants")[0]
        before = self.snapshot()
        self.assertEqual(len(expected["restaurants"]), 6)
        for headers in ({}, {"X-Manjeo-Account": "demo-client"}):
            self.assertEqual(self.request("GET", "/api/restaurants", role="client", headers=headers)[0], expected)
        for role in ("restaurant", "courier", "admin"):
            for headers in ({}, {"X-Manjeo-Account": "demo-" + role}):
                with self.subTest(role=role, headers=bool(headers)):
                    response = self.request("GET", "/api/restaurants", role=role, status=403, headers=headers)[0]
                    self.assertNotIn("restaurants", response)
        self.assertEqual(self.snapshot(), before)

    def test_workspace_catalog_is_scoped_to_the_current_restaurant_or_admin(self):
        public = self.request("GET", "/api/restaurants")[0]["restaurants"]
        before = self.snapshot()
        endpoint = "/api/workspace/restaurants"
        self.request("GET", endpoint, status=401, headers={"X-Manjeo-Account": "demo-admin"})
        for role in ("client", "courier"):
            self.request("GET", endpoint, role=role, status=403)
        own = [restaurant for restaurant in public if restaurant["id"] == "ti-kreol"]
        for suffix in ("", "?restaurantId=smash-club", "?role=admin"):
            response, headers = self.request("GET", endpoint + suffix, role="restaurant",
                                             headers={"X-Manjeo-Account": "demo-restaurant"})
            self.assertEqual(response, {"restaurants": own})
            self.assertIn("no-store", headers["Cache-Control"])
        self.assertEqual(self.request("GET", endpoint, role="admin",
                         headers={"X-Manjeo-Account": "demo-admin"})[0], {"restaurants": public})
        self.assertEqual(self.snapshot(), before)

    def test_unassigned_restaurant_has_no_implicit_access_to_another_establishment(self):
        self.add_test_user("unassigned-restaurant", "restaurant")
        self.login("unassigned-restaurant")
        before = self.snapshot()
        self.assertEqual(self.request("GET", "/api/workspace/restaurants", role="unassigned-restaurant")[0],
                         {"restaurants": []})
        self.request("GET", "/api/restaurants", role="unassigned-restaurant", status=403)
        self.request("GET", "/api/restaurants/ti-kreol/menu", role="unassigned-restaurant", status=403)
        self.assertEqual(self.snapshot(), before)

    def test_account_context_precedes_role_checks_and_expired_session_has_no_workspace(self):
        before = self.snapshot()
        for role in ("client", "restaurant", "courier", "admin"):
            for endpoint in ("/api/restaurants", "/api/workspace/restaurants"):
                response = self.request("GET", endpoint, role=role, status=409,
                                        headers={"X-Manjeo-Account": "another-account"})[0]
                self.assertEqual(response.get("code"), "session_changed")
        self.assertEqual(self.snapshot(), before)
        with self.database.connect() as db:
            self.database.begin_write(db)
            db.execute("UPDATE sessions SET expires_at=? WHERE user_id='demo-restaurant'", (int(time.time()) - 1,))
        before = self.snapshot()
        self.request("GET", "/api/workspace/restaurants", role="restaurant", status=401)
        self.assertEqual(len(self.request("GET", "/api/restaurants", role="restaurant")[0]["restaurants"]), 6)
        self.assertEqual(self.snapshot(), before)

    def test_professionals_cannot_execute_customer_actions_or_call_payment_and_address_providers(self):
        payload = self.order_payload()
        order = self.create_order(payload)
        actions = (
            ("POST", "/api/orders", payload),
            ("POST", "/api/addresses/verify", {"address": "7 Rue Lallouette", "city": "Cayenne"}),
            ("POST", "/api/promotions/check", {"code": "BIENVENUE", "restaurantId": "ti-kreol",
                                                "city": "Cayenne", "subtotal": 2500}),
            ("POST", "/api/orders/" + order["id"] + "/checkout", {}),
            ("PATCH", "/api/profile", {"name": "Unchanged", "deliveryAddress": None}),
            ("PATCH", "/api/profile", {"name": "Unchanged", "paymentMethod": "demo"}),
        )
        before = self.snapshot()
        with patch.object(customer, "geocode") as geocode, patch.object(payments, "stripe_request") as stripe:
            for role in ("restaurant", "courier", "admin"):
                for method, endpoint, body in actions:
                    with self.subTest(role=role, endpoint=endpoint, body=tuple(body)):
                        self.request(method, endpoint, body, role=role, status=403,
                                     headers={"X-Manjeo-Account": "demo-" + role})
                        self.assertEqual(self.snapshot(), before)
            geocode.assert_not_called()
            stripe.assert_not_called()

    def test_business_read_permissions_do_not_grant_access_to_another_role(self):
        routes = (
            ("/api/restaurants/ti-kreol/menu", {"restaurant", "admin"}),
            ("/api/restaurants/smash-club/menu", {"admin"}),
            ("/api/deliveries", {"courier"}),
            ("/api/couriers", {"admin"}),
            ("/api/users", {"admin"}),
        )
        before = self.snapshot()
        for endpoint, permitted in routes:
            for role in ("client", "restaurant", "courier", "admin"):
                with self.subTest(role=role, endpoint=endpoint):
                    self.request("GET", endpoint, role=role, status=200 if role in permitted else 403,
                                 headers={"X-Manjeo-Account": "demo-" + role})
                    self.assertEqual(self.snapshot(), before)
