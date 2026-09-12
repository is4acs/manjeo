"""Optional real PostgreSQL integration suite, isolated from the app schema.

Set MANJEO_TEST_DATABASE_URL explicitly to run. DATABASE_URL and POSTGRES_URL
are deliberately ignored. Each test creates and drops only its own unique
manjeo_test_<uuid> schema; no production tables are reset or truncated.
"""
import copy
import http.client
import json
import os
import re
import tempfile
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    from . import app, test_app
except ImportError:
    from server import app, test_app


TEST_DATABASE_URL = os.environ.get("MANJEO_TEST_DATABASE_URL")


@unittest.skipUnless(TEST_DATABASE_URL, "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresIntegrationTests(test_app.AppIntegrationTests):
    def setUp(self):
        try:
            from .postgres import PostgresDatabase
        except ImportError:
            from server.postgres import PostgresDatabase
        self.database_type = PostgresDatabase
        self.schema = "manjeo_test_" + uuid.uuid4().hex
        self.assertRegex(self.schema, r"^manjeo_test_[0-9a-f]{32}$")
        # Register cleanup before setup so partial initialization also cleans up.
        self.addCleanup(self.drop_owned_schema)
        self.database = PostgresDatabase(TEST_DATABASE_URL, schema=self.schema)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        static = Path(self.directory.name) / "dist"
        static.mkdir()
        (static / "index.html").write_text("<html>Manjéo test</html>")
        self.server = app.ManjeoServer(("127.0.0.1", 0), self.database, static,
                                      config=app.AppConfig(cloud=False))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)
        self.port = self.server.server_port
        self.cookies = {}

    def tearDown(self):
        # addCleanup runs even when setup fails; never call SQLite teardown.
        pass

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def drop_owned_schema(self):
        import psycopg
        from psycopg import sql
        if not re.fullmatch(r"manjeo_test_[0-9a-f]{32}", self.schema):
            raise AssertionError("Refusing cleanup outside this test's isolated schema")
        with psycopg.connect(TEST_DATABASE_URL) as connection:
            connection.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(self.schema)))

    def send_concurrently(self, requests):
        barrier = threading.Barrier(len(requests))

        def send(request):
            method, path, payload, role = request
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
            headers = {"Content-Type": "application/json", "Cookie": self.cookies[role],
                       "Origin": "http://127.0.0.1:%d" % self.port}
            barrier.wait(timeout=10)
            connection.request(method, path, json.dumps(payload), headers)
            response = connection.getresponse()
            result = response.status, json.loads(response.read())
            connection.close()
            return result

        with ThreadPoolExecutor(max_workers=len(requests)) as executor:
            return list(executor.map(send, requests))

    def test_idempotency_concurrency_conflict_and_persistence(self):
        self.login("client")
        payload = self.order_payload()
        results = self.send_concurrently([
            ("POST", "/api/orders", payload, "client"),
            ("POST", "/api/orders", payload, "client"),
        ])
        self.assertEqual(sorted(status for status, _ in results), [200, 201], results)
        self.assertEqual(results[0][1]["order"]["id"], results[1][1]["order"]["id"])
        modified = copy.deepcopy(payload)
        modified["notes"] = "Autre contenu"
        self.request("POST", "/api/orders", modified, role="client", status=409)
        self.login("restaurant")
        self.request("PATCH", "/api/restaurants/ti-kreol", {"acceptingOrders": False}, role="restaurant")
        self.request("POST", "/api/orders", payload, role="client")
        # A fresh serverless instance must see the same durable records and seed
        # again without replacing restaurant settings, orders, or users.
        reloaded = self.database_type(TEST_DATABASE_URL, schema=self.schema)
        with reloaded.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT accepting_orders FROM restaurants WHERE id = 'ti-kreol'").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM users").fetchone()[0], 3)
        self.server.database = reloaded
        self.server.application = app.AppState(reloaded, app.AppConfig(cloud=False))
        order = self.request("GET", "/api/orders", role="client")[0]["orders"][0]
        self.assertEqual(order["id"], results[0][1]["order"]["id"])

    def test_concurrent_status_change_has_one_transition(self):
        order = self.create_order()
        self.login("restaurant")
        self.login("admin")
        endpoint = "/api/orders/" + order["id"]
        results = self.send_concurrently([
            ("PATCH", endpoint, {"status": "accepted"}, "restaurant"),
            ("PATCH", endpoint, {"status": "accepted"}, "admin"),
        ])
        self.assertEqual(sorted(status for status, _ in results), [200, 409], results)
        persisted = self.request("GET", "/api/orders", role="client")[0]["orders"][0]
        self.assertEqual(persisted["status"], "accepted")
        self.assertEqual([event["status"] for event in persisted["history"]], ["pending", "accepted"])

    def test_concurrent_instances_seed_once_without_resetting_catalog(self):
        self.login("restaurant")
        self.request("PATCH", "/api/restaurants/ti-kreol/products/kreol-poulet",
                     {"available": False}, role="restaurant")
        with ThreadPoolExecutor(max_workers=2) as executor:
            databases = list(executor.map(
                lambda _: self.database_type(TEST_DATABASE_URL, schema=self.schema), range(2)))
        with databases[0].connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM restaurants").fetchone()[0], 6)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM products").fetchone()[0], 24)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM users").fetchone()[0], 3)
            self.assertEqual(connection.execute("SELECT available FROM products WHERE id = 'kreol-poulet'").fetchone()[0], 0)

    def test_failed_login_limit_survives_instances_and_expires(self):
        invalid = {"email": "client@manjeo.test", "password": "wrong"}
        for _ in range(10):
            self.request("POST", "/api/login", invalid, status=401)
        reloaded = self.database_type(TEST_DATABASE_URL, schema=self.schema)
        self.server.application = app.AppState(reloaded, app.AppConfig(cloud=False))
        for _ in range(10):
            self.request("POST", "/api/login", invalid, status=401)
        self.request("POST", "/api/login", invalid, status=429)
        # A different account remains usable; failures belong to IP + email.
        self.login("admin")
        with reloaded.connect() as connection:
            self.assertGreater(connection.execute("SELECT COUNT(*) FROM login_attempts").fetchone()[0], 0)
            connection.execute("UPDATE login_attempts SET attempted_at = 0")
        self.request("POST", "/api/login", invalid, status=401)
        self.login("client")


if __name__ == "__main__":
    unittest.main()
