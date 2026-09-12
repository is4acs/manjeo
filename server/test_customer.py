"""Verified delivery-address contracts; external geocoders are always mocked."""
import json
import http.client
import os
import threading
import time
import unittest
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from server import addresses, customer
from server.test_addresses import Response
from server.test_app import AppTestHarness


def ign_feature(**changes):
    value = {"type": "Feature", "properties": {"name": "7 Rue Lallouette", "citycode": "97302", "type": "housenumber", "score": 0.98},
             "geometry": {"type": "Point", "coordinates": [-52.332754, 4.939915]}}
    for group, updates in changes.items():
        value[group].update(updates)
    return value



class AddressGeocodingTests(unittest.TestCase):
    def setUp(self):
        network = patch.object(addresses._opener, "open")
        self.network = network.start(); self.addCleanup(network.stop)
        self.network.side_effect = lambda *args, **kwargs: Response({"type": "FeatureCollection", "features": [ign_feature()]})

    def test_real_ign_result_contains_coordinates_and_honest_provenance(self):
        result = addresses.geocode("7 Rue Lallouette", "Cayenne")
        self.assertEqual(result["source"], "ign")
        self.assertEqual(result["candidates"], [{"address": "7 Rue Lallouette", "city": "Cayenne", "latitude": 4.939915,
                                                "longitude": -52.332754, "provider": "ign", "precision": "house"}])
        request = self.network.call_args.args[0]
        self.assertEqual(urlsplit(request.full_url).netloc, "data.geopf.fr")
        self.assertEqual(parse_qs(urlsplit(request.full_url).query)["citycode"], ["97302"])
        self.assertEqual(self.network.call_args.kwargs["timeout"], 2.5)

    def test_demo_suggestion_or_provider_outage_cannot_verify_an_address(self):
        self.network.side_effect = TimeoutError()
        with patch.object(addresses, "suggest") as suggest:
            with self.assertRaises(addresses.AddressServiceUnavailable):
                addresses.geocode("7 Rue Lallouette", "Cayenne")
            suggest.assert_not_called()

    def test_wrong_city_invalid_point_low_confidence_and_city_center_are_rejected(self):
        bad = [ign_feature(properties={"citycode": "97309"}), ign_feature(properties={"score": 0.49}),
               ign_feature(properties={"type": "municipality"}), ign_feature(properties={"score": True}),
               ign_feature(geometry={"coordinates": [4.9, -52.3]}), ign_feature(geometry={"coordinates": [-52.3, float("nan")]}),
               ign_feature(geometry={"coordinates": [-52.3, True]}), ign_feature(geometry={"type": "Polygon"})]
        self.network.side_effect = lambda *args, **kwargs: Response({"type": "FeatureCollection", "features": bad})
        self.assertEqual(addresses.geocode("7 Rue Lallouette", "Cayenne")["candidates"], [])


class CustomerAddressContracts:
    def setup_customer(self):
        self.login("client")
        env = patch.dict(os.environ, {"MANJEO_ADDRESS_REQUESTS_PER_MINUTE": "10", "MANJEO_ADDRESS_REQUESTS_PER_DAY": "200"})
        env.start(); self.addCleanup(env.stop)
        geocoder = patch.object(customer, "geocode")
        self.geocoder = geocoder.start(); self.addCleanup(geocoder.stop)
        self.candidate = {"address": "7 Rue Lallouette", "city": "Cayenne", "latitude": 4.939915,
                          "longitude": -52.332754, "provider": "ign", "precision": "house"}
        self.geocoder.side_effect = lambda *args: {"candidates": [self.candidate.copy()], "source": "ign"}

    def verify(self, status=200, role="client"):
        return self.request("POST", "/api/addresses/verify", {"address": "7 rue lallouette", "city": "Cayenne"}, role=role, status=status)[0]

    def save_address(self):
        candidate = self.verify()["candidates"][0]
        value = {"address": candidate["address"], "city": candidate["city"], "details": "Portail bleu",
                 "verificationToken": candidate["verificationToken"]}
        saved = self.request("PATCH", "/api/profile", {"deliveryAddress": value}, role="client")[0]["user"]["deliveryAddress"]
        return candidate, saved

    def verified_payload(self):
        candidate = self.verify()["candidates"][0]
        payload = self.order_payload()
        payload.update(address=candidate["address"], city=candidate["city"], addressVerificationToken=candidate["verificationToken"])
        return payload

    def test_only_authenticated_clients_can_verify_and_invalid_input_never_reaches_provider(self):
        self.verify(role=None, status=401)
        for role in ("admin", "courier", "restaurant"):
            self.login(role)
            self.verify(role=role, status=403)
        for body in ({"address": "7 rue", "city": "Paris"}, {"address": "7 rue", "city": "Cayenne", "latitude": 4.9},
                     {"address": {}, "city": "Cayenne"}):
            self.request("POST", "/api/addresses/verify", body, role="client", status=400)
        self.geocoder.assert_not_called()

    def test_confirmed_address_and_payment_preference_are_owner_only_and_survive_initialization(self):
        token, saved = self.save_address()
        self.assertEqual(saved["provider"], "ign")
        self.assertEqual(saved["address"], "7 Rue Lallouette")
        self.assertNotIn("verificationToken", saved)
        self.assertNotIn("expiresAt", saved)
        user = self.request("PATCH", "/api/profile", {"paymentMethod": "stripe", "name": "Camille Adresse"}, role="client")[0]["user"]
        self.assertEqual(user["paymentMethod"], "stripe")
        self.assertEqual(user["deliveryAddress"], saved)
        self.database.initialize()
        for endpoint in ("/api/profile", "/api/session"):
            current = self.request("GET", endpoint, role="client")[0]["user"]
            self.assertEqual(current["deliveryAddress"], saved)
            self.assertEqual(current["paymentMethod"], "stripe")
        self.login("admin")
        users = self.request("GET", "/api/users", role="admin")[0]["users"]
        self.assertTrue(all("deliveryAddress" not in user and "paymentMethod" not in user for user in users))
        with self.database.connect() as db:
            rows = db.execute("SELECT token_hash,data FROM address_verifications").fetchall()
            self.assertTrue(rows)
            self.assertNotIn(token["verificationToken"], json.dumps([dict(row) for row in rows]))

    def test_profile_rejects_forged_changed_expired_and_another_customers_confirmation(self):
        candidate = self.verify()["candidates"][0]
        value = {"address": candidate["address"], "city": candidate["city"], "details": "Bâtiment A", "verificationToken": candidate["verificationToken"]}
        self.request("PATCH", "/api/profile", {"deliveryAddress": {**value, "latitude": 0}}, role="client", status=400)
        self.request("PATCH", "/api/profile", {"deliveryAddress": {**value, "address": "8 Rue Lallouette"}}, role="client", status=409)
        self.add_test_user("another-client", "client")
        self.login("another-client")
        self.request("PATCH", "/api/profile", {"deliveryAddress": value}, role="another-client", status=409)
        with patch.object(customer, "now_iso", return_value=candidate["expiresAt"]):
            self.request("PATCH", "/api/profile", {"deliveryAddress": value}, role="client", status=409)
        self.assertIsNone(self.request("GET", "/api/profile", role="client")[0]["user"]["deliveryAddress"])

    def test_profile_details_can_change_without_extending_the_original_verification(self):
        _, saved = self.save_address()
        later = customer._iso(customer._instant(saved["confirmedAt"]) + timedelta(days=2))
        with patch.object(customer, "now_iso", return_value=later):
            value = {"address": saved["address"], "city": saved["city"], "details": "Porte à droite"}
            current = self.request("PATCH", "/api/profile", {"deliveryAddress": value}, role="client")[0]["user"]["deliveryAddress"]
        self.assertEqual(current["verifiedAt"], saved["verifiedAt"])
        self.assertEqual(current["verificationExpiresAt"], saved["verificationExpiresAt"])
        self.assertEqual(current["details"], "Porte à droite")
        self.request("PATCH", "/api/profile", {"deliveryAddress": None}, role="client")
        self.assertIsNone(self.request("GET", "/api/profile", role="client")[0]["user"]["deliveryAddress"])

    def test_address_and_payment_updates_reject_other_roles_and_invalid_payment_values(self):
        for role in ("admin", "courier", "restaurant"):
            self.login(role)
            for body in ({"deliveryAddress": None}, {"paymentMethod": "demo"}):
                self.request("PATCH", "/api/profile", body, role=role, status=403)
        for value in (None, {}, "cash", "card", True):
            self.request("PATCH", "/api/profile", {"paymentMethod": value}, role="client", status=400)
        self.assertEqual(self.request("GET", "/api/profile", role="client")[0]["user"]["paymentMethod"], "demo")

    def test_provider_failure_or_empty_result_never_issues_a_confirmation(self):
        self.geocoder.side_effect = addresses.AddressServiceUnavailable()
        self.verify(status=503)
        self.geocoder.side_effect = lambda *args: {"candidates": [], "source": "ign"}
        self.assertEqual(self.verify()["candidates"], [])
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM address_verifications").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM address_verification_usage").fetchone()[0], 2)

    def test_quota_is_durable_and_releases_the_database_before_geocoding(self):
        def during_geocode(*args):
            started = time.monotonic()
            self.request("PATCH", "/api/profile", {"name": "Client non bloqué"}, role="client")
            self.assertLess(time.monotonic() - started, 2)
            return {"candidates": [self.candidate.copy()], "source": "ign"}
        self.geocoder.side_effect = during_geocode
        with patch.dict(os.environ, {"MANJEO_ADDRESS_REQUESTS_PER_MINUTE": "1"}):
            self.verify()
            self.database.initialize()
            self.verify(status=429)
        self.assertEqual(self.geocoder.call_count, 1)

    def test_concurrent_verifications_cannot_exceed_the_shared_daily_quota(self):
        self.add_test_user("second-client", "client")
        self.login("second-client")
        barrier = threading.Barrier(2)
        def verify(role):
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            barrier.wait(timeout=5)
            connection.request("POST", "/api/addresses/verify", json.dumps({"address": "7 Rue Lallouette", "city": "Cayenne"}),
                               {"Cookie": self.cookies[role], "Content-Type": "application/json", "Origin": "http://127.0.0.1:%s" % self.port})
            response = connection.getresponse()
            status = response.status
            response.read(); connection.close()
            return status
        with patch.dict(os.environ, {"MANJEO_ADDRESS_REQUESTS_PER_DAY": "1"}), ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(verify, ["client", "second-client"]))
        self.assertEqual(sorted(results), [200, 429])
        self.assertEqual(self.geocoder.call_count, 1)

    def test_session_revoked_during_geocoding_cannot_receive_a_confirmation_token(self):
        def during_geocode(*args):
            self.request("POST", "/api/logout", {}, role="client")
            return {"candidates": [self.candidate.copy()], "source": "ign"}
        self.geocoder.side_effect = during_geocode
        self.verify(status=401)
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM address_verifications").fetchone()[0], 0)

    def test_new_orders_require_verified_addresses_but_replay_survives_token_expiry(self):
        payload = self.order_payload()
        del payload["addressVerificationToken"]
        self.request("POST", "/api/orders", payload, role="client", status=409)
        payload = self.verified_payload()
        order = self.create_order(payload)
        with patch.object(customer, "now_iso", return_value="2100-01-01T00:00:00.000Z"):
            replay = self.request("POST", "/api/orders", payload, role="client")[0]["order"]
        self.assertEqual(replay, order)

    def test_default_address_point_is_snapshotted_with_order_specific_details_and_private_coordinates(self):
        _, saved = self.save_address()
        payload = self.order_payload()
        payload.pop("addressVerificationToken")
        payload.update(address=saved["address"], city=saved["city"], details="Remise au portail", useDefaultAddress=True)
        order = self.create_order(payload)
        self.assertEqual(order["deliveryLocation"]["latitude"], saved["latitude"])
        self.assertEqual(order["details"], "Remise au portail")
        self.assertNotIn("verificationToken", order["deliveryLocation"])
        self.assertEqual(self.request("GET", "/api/profile", role="client")[0]["user"]["deliveryAddress"]["details"], "Portail bleu")
        self.request("PATCH", "/api/profile", {"deliveryAddress": None}, role="client")
        current = self.request("GET", "/api/orders", role="client")[0]["orders"][0]
        self.assertEqual(current["deliveryLocation"], order["deliveryLocation"])
        self.login("restaurant")
        kitchen = self.request("GET", "/api/orders", role="restaurant")[0]["orders"][0]
        self.assertNotIn("deliveryLocation", kitchen)
        self.assertNotIn("deliveryCode", kitchen)
        for status in ("accepted", "preparing", "ready"):
            self.request("PATCH", "/api/orders/" + order["id"], {"status": status}, role="restaurant")
        self.login("courier")
        self.request("PATCH", "/api/courier/profile", {"online": True}, role="courier")
        offers = self.request("GET", "/api/deliveries", role="courier")[0]["available"]
        self.assertTrue(all("deliveryLocation" not in row and "deliveryCode" not in row for row in offers))
        assigned = self.request("POST", "/api/orders/" + order["id"] + "/claim", {}, role="courier")[0]["order"]
        self.assertEqual(assigned["deliveryLocation"], order["deliveryLocation"])
        self.assertNotIn("deliveryCode", assigned)

    def test_saved_address_expiry_and_mutated_checkout_address_are_refused(self):
        _, saved = self.save_address()
        payload = self.order_payload()
        payload.pop("addressVerificationToken")
        payload.update(address=saved["address"], city=saved["city"], useDefaultAddress=True)
        with patch.object(customer, "now_iso", return_value=saved["verificationExpiresAt"]):
            self.request("POST", "/api/orders", payload, role="client", status=409)
        payload["address"] = "Autre adresse numéro 24"
        self.request("POST", "/api/orders", payload, role="client", status=409)


class CustomerAddressTests(CustomerAddressContracts, AppTestHarness):
    def setUp(self):
        super().setUp()
        self.setup_customer()


@unittest.skipUnless(os.environ.get("MANJEO_TEST_DATABASE_URL"), "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresCustomerAddressTests(CustomerAddressContracts, AppTestHarness):
    from server.test_postgres import PostgresIntegrationTests as _Harness
    def setUp(self):
        self._Harness.setUp(self)
        self.setup_customer()
    tearDown = _Harness.tearDown
    close_server = _Harness.close_server
    drop_owned_schema = _Harness.drop_owned_schema


if __name__ == "__main__":
    unittest.main()
