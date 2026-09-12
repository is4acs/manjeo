"""JSON transport boundaries shared by SQLite and PostgreSQL, without providers."""
import hashlib
import http.client
import io
import json
import os
import unittest

from server.app import APIError, Handler, MAX_JSON_DEPTH, validate_json_value
from server.test_app import AppTestHarness


class JSONInputContracts:
    def raw_request(self, raw, status, path="/api/login", role=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        headers = {"Content-Type": "application/json"}
        if role:
            headers["Cookie"] = self.cookies[role]
        connection.request("POST", path, raw, headers)
        response = connection.getresponse()
        body = json.loads(response.read())
        connection.close()
        self.assertEqual(response.status, status, body)
        return body

    def test_unstoreable_strings_are_rejected_in_keys_values_and_nested_containers(self):
        self.login("client")
        payload = self.order_payload()
        before = self.request("GET", "/api/profile", role="client")[0]["user"]
        for character in ("\x00", "\ud800", "\udfff"):
            cases = [({"name": "Camille" + character}, "PATCH", "/api/profile"),
                     ({character: "value"}, "PATCH", "/api/profile"),
                     ({**payload, "extra": [{"nested": "bad" + character}]}, "POST", "/api/orders"),
                     ({**payload, "extra": [{character: "value"}]}, "POST", "/api/orders")]
            for body, method, path in cases:
                with self.subTest(character=repr(character), method=method, path=path):
                    result = self.request(method, path, body, role="client", status=400)[0]
                    self.assertEqual(result, {"error": "Le JSON est invalide."})
        self.assertEqual(self.request("GET", "/api/profile", role="client")[0]["user"], before)
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 0)

    def test_login_rejects_invalid_unicode_before_password_hashing_or_failed_attempts(self):
        for field in ("email", "password"):
            for character in ("\x00", "\ud800", "\udfff"):
                body = {"email": "client@manjeo.test", "password": "ManjeoDemo2026!", field: "bad" + character}
                self.assertEqual(self.request("POST", "/api/login", body, status=400)[0], {"error": "Le JSON est invalide."})
        self.assertEqual(self.raw_request(b'{"password":"\xed\xa0\x80"}', 400), {"error": "Le JSON est invalide."})
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM login_attempts").fetchone()[0], 0)

    def test_valid_multilingual_unicode_remains_exact_and_order_replay_hash_is_unchanged(self):
        self.login("client")
        name = "Camille e\u0301 · Mèsi · São · 中文 · 🧑🏾‍🍳"
        profile = self.request("PATCH", "/api/profile", {"name": name}, role="client")[0]["user"]
        self.assertEqual(profile["name"], name)
        payload = self.order_payload()
        payload.update(customerName=name, notes="Mèsi 🥘\n\tSem pimenta", extra={"cle\u0301": ["é", "e\u0301", "🍽️"]})
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        order = self.raw_request(raw, 201, "/api/orders", "client")["order"]
        self.assertEqual(order["customerName"], name)
        self.assertEqual(order["notes"], payload["notes"])
        # Escaped surrogate PAIRS are valid Unicode; encoding JSON differently
        # must preserve the same semantic body and the pre-existing request hash.
        replay = self.raw_request(json.dumps(payload, ensure_ascii=True).encode(), 200, "/api/orders", "client")["order"]
        self.assertEqual(replay, order)
        expected = hashlib.sha256(json.dumps({key: value for key, value in payload.items() if key != "requestId"},
                                             sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with self.database.connect() as db:
            rows = db.execute("SELECT request_hash FROM orders").fetchall()
            self.assertEqual([row["request_hash"] for row in rows], [expected])

    def test_excessive_depth_and_non_finite_numbers_receive_controlled_400(self):
        for depth in (MAX_JSON_DEPTH, 10000):
            raw = b'{"extra":' + b'[' * depth + b'0' + b']' * depth + b'}'
            self.assertLess(len(raw), 64000)
            self.assertEqual(self.raw_request(raw, 400), {"error": "Le JSON est invalide."})
        for value in (b"NaN", b"Infinity", b"-Infinity", b"1e999"):
            self.assertEqual(self.raw_request(b'{"extra":[' + value + b']}', 400), {"error": "Le JSON est invalide."})
        nested = 0
        for _ in range(MAX_JSON_DEPTH - 1):
            nested = [nested]
        body = {"email": "client@manjeo.test", "password": "ManjeoDemo2026!", "extra": nested}
        self.assertEqual(self.request("POST", "/api/login", body)[0]["user"]["id"], "demo-client")


class JSONInputTests(JSONInputContracts, AppTestHarness):
    pass


@unittest.skipUnless(os.environ.get("MANJEO_TEST_DATABASE_URL"), "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresJSONInputTests(JSONInputContracts, AppTestHarness):
    from server.test_postgres import PostgresIntegrationTests as _Harness
    setUp = _Harness.setUp
    tearDown = _Harness.tearDown
    close_server = _Harness.close_server
    drop_owned_schema = _Harness.drop_owned_schema


class JSONBoundaryTests(unittest.TestCase):
    def read(self, body, path="/api/orders", declared=None):
        handler = object.__new__(Handler)
        handler.path = path
        handler.headers = {"Content-Type": "application/json", "Content-Length": str(len(body) if declared is None else declared)}
        handler.rfile = io.BytesIO(body)
        return handler.read_json()

    def test_size_limits_remain_route_specific_and_count_bytes(self):
        for path, maximum in (("/api/orders", 64000), ("/api/login", 64000),
                              ("/api/restaurants/ti-kreol/images", 1500000), ("/api/restaurants/ti-kreol/menu", 1500000)):
            body = b'{"value":"\xc3\xa9"}'
            body += b" " * (maximum - len(body))
            self.assertEqual(self.read(body, path), {"value": "é"})
            with self.assertRaises(APIError) as error:
                self.read(body + b" ", path)
            self.assertEqual(error.exception.status, 413)
        with self.assertRaises(APIError) as error:
            self.read(b"{}", declared=3)
        self.assertEqual(error.exception.status, 400)
        with self.assertRaises(APIError) as error:
            self.read(b"", declared=0)
        self.assertEqual(error.exception.status, 400)

    def test_iterative_validation_preserves_values_and_does_not_confuse_breadth_with_depth(self):
        data = {"many": ["áéï 🥘\n\t"] * 10000, "number": 1.5, "nested": [{"name": "e\u0301"}]}
        before = json.dumps(data, ensure_ascii=False)
        validate_json_value(data)
        self.assertEqual(json.dumps(data, ensure_ascii=False), before)
