"""Exercise upgrades from the actual three-role schema, never production tables."""
import copy
import hashlib
import http.client
import json
import os
import re
import sqlite3
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path

from server.app import Database, ManjeoServer, ROOT, password_digest

LEGACY_TABLES = (
    """CREATE TABLE restaurants (id TEXT PRIMARY KEY, data TEXT NOT NULL,
       accepting_orders INTEGER NOT NULL DEFAULT 1 CHECK (accepting_orders IN (0,1)),
       sort_order INTEGER NOT NULL DEFAULT 0)""",
    """CREATE TABLE products (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
       data TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
       sort_order INTEGER NOT NULL DEFAULT 0)""",
    """CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
       name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('client','restaurant','admin')),
       restaurant_id TEXT REFERENCES restaurants(id), password_salt TEXT NOT NULL, password_hash TEXT NOT NULL)""",
    """CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
       expires_at BIGINT NOT NULL)""",
    """CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id),
       restaurant_id TEXT NOT NULL REFERENCES restaurants(id), request_id TEXT NOT NULL,
       request_hash TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL,
       UNIQUE(customer_id, request_id))""",
)


def legacy_order_payload():
    return {"restaurantId": "ti-kreol", "customerName": "Camille Test", "phone": "0694000000",
            "address": "12 rue de la Démonstration", "city": "Cayenne", "details": "", "notes": "",
            "requestId": "00000000-0000-4000-8000-000000000001",
            "items": [{"productId": "kreol-poulet", "quantity": 2, "portion": "Classique", "sauce": "Sans piment"}]}


def seed_legacy_database(db):
    for statement in LEGACY_TABLES:
        db.execute(statement)
    for position, source in enumerate(json.loads((ROOT / "lib/catalog.json").read_text())):
        restaurant = {key: value for key, value in source.items() if key not in ("products", "acceptingOrders")}
        db.execute("INSERT INTO restaurants VALUES (?, ?, ?, ?)",
                   (source["id"], json.dumps(restaurant), 0 if position == 0 else 1, position + 17))
        for number, item in enumerate(source["products"]):
            if item["id"] == "kreol-dessert":
                continue  # A product removed before the upgrade must stay removed.
            product = {key: value for key, value in item.items() if key != "available"}
            if item["id"] == "kreol-poulet":
                product.update(name="Poulet de la carte modifiée", price=1777,
                               image="/images/custom-legacy.jpg")
            db.execute("INSERT INTO products VALUES (?, ?, ?, ?, ?)",
                       (item["id"], source["id"], json.dumps(product), 0 if number == 0 else 1, number + 33))
    salt = "ab" * 16
    digest = password_digest("ManjeoDemo2026!", salt)
    for role in ("client", "restaurant", "admin"):
        db.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
                   ("demo-" + role, role + "@manjeo.test", "Legacy " + role,
                    role, "ti-kreol" if role == "restaurant" else None, salt, digest))
    token = hashlib.sha256(b"legacy-session-still-valid").hexdigest()
    db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (token, "demo-client", int(time.time()) + 3600))
    order = {
        "id": "MJ-LEGACY001", "customerId": "demo-client", "restaurantId": "ti-kreol",
        "restaurant": "Ti Kaz Kréol", "customerName": "Camille Test", "phone": "0694000000",
        "address": "12 rue de la Démonstration", "city": "Cayenne", "details": "", "notes": "",
        "status": "delivered", "subtotal": 2200, "delivery": 250, "total": 2450, "count": 2,
        "date": "2026-01-01T12:00:00.000Z", "updatedAt": "2026-01-01T13:00:00.000Z",
        "items": [{"productId": "kreol-poulet", "name": "Poulet boucané original", "price": 1100,
                   "quantity": 2, "option": "Classique · Sans piment"}],
        "history": [{"status": "pending", "date": "2026-01-01T12:00:00.000Z"},
                    {"status": "delivered", "date": "2026-01-01T13:00:00.000Z"}],
    }
    original_payload = legacy_order_payload()
    request_hash = hashlib.sha256(json.dumps({key: value for key, value in original_payload.items() if key != "requestId"}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    db.execute("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)",
               (order["id"], "demo-client", "ti-kreol", original_payload["requestId"], request_hash, order["date"], json.dumps(order)))
    ready = copy.deepcopy(order)
    ready.update(id="MJ-LEGACY002", status="ready")
    ready["history"] = [{"status": status, "date": order["date"]} for status in ("pending", "accepted", "preparing", "ready")]
    db.execute("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)",
               (ready["id"], "demo-client", "ti-kreol", str(uuid.uuid4()), "legacy-ready-hash", ready["date"], json.dumps(ready)))
    return digest, token, [order, ready]


class LegacyMigrationAssertions:
    def assert_legacy_records_preserved(self, database, expected):
        digest, token, old_orders = expected
        with database.connect() as db:
            users = db.execute("SELECT * FROM users ORDER BY id").fetchall()
            self.assertEqual({user["role"] for user in users}, {"client", "restaurant", "admin", "courier"})
            self.assertEqual(len(users), 4)
            courier = next(user for user in users if user["role"] == "courier")
            self.assertEqual(courier["email"], "livreur@manjeo.test")
            self.assertEqual(db.execute("SELECT password_hash FROM users WHERE id = 'demo-client'").fetchone()[0], digest)
            self.assertEqual(db.execute("SELECT user_id FROM sessions WHERE token_hash = ?", (token,)).fetchone()[0], "demo-client")
            restaurant = db.execute("SELECT * FROM restaurants WHERE id = 'ti-kreol'").fetchone()
            self.assertEqual(restaurant["accepting_orders"], 0)
            self.assertEqual(restaurant["sort_order"], 17)
            product = db.execute("SELECT * FROM products WHERE id = 'kreol-poulet'").fetchone()
            self.assertEqual(product["available"], 0)
            self.assertEqual(product["sort_order"], 33)
            details = json.loads(product["data"])
            self.assertEqual(details["name"], "Poulet de la carte modifiée")
            self.assertEqual(details["price"], 1777)
            self.assertEqual(details["image"], "/images/custom-legacy.jpg")
            self.assertIsNone(db.execute("SELECT id FROM products WHERE id = 'kreol-dessert'").fetchone())
            for old_order in old_orders:
                persisted = json.loads(db.execute("SELECT data FROM orders WHERE id = ?", (old_order["id"],)).fetchone()[0])
                for key in ("id", "status", "subtotal", "total", "items", "history"):
                    self.assertEqual(persisted[key], old_order[key], key)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 2)

    def assert_legacy_ready_can_be_delivered(self, database):
        server = ManjeoServer(("127.0.0.1", 0), database)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        thread.start()
        try:
            def request(method, path, data=None, cookie=None):
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=20)
                headers = {"Content-Type": "application/json"}
                if cookie:
                    headers["Cookie"] = cookie
                connection.request(method, path, json.dumps(data) if data is not None else None, headers)
                response = connection.getresponse()
                payload = json.loads(response.read())
                self.assertEqual(response.status, 200, payload)
                returned_cookie = response.getheader("Set-Cookie", "").split(";", 1)[0]
                connection.close()
                return payload, returned_cookie

            client_cookie = "manjeo_session=legacy-session-still-valid"
            session, _ = request("GET", "/api/session", cookie=client_cookie)
            self.assertEqual(session["user"]["id"], "demo-client")
            replay, _ = request("POST", "/api/orders", legacy_order_payload(), client_cookie)
            self.assertEqual(replay["order"]["id"], "MJ-LEGACY001")
            self.assertEqual(replay["order"]["total"], 2450)
            orders, _ = request("GET", "/api/orders", cookie=client_cookie)
            ready = next(order for order in orders["orders"] if order["id"] == "MJ-LEGACY002")
            self.assertEqual(ready["status"], "ready")
            self.assertIsNone(ready["courierId"])
            self.assertRegex(ready["deliveryCode"], r"^[0-9]{4}$")
            _, courier_cookie = request("POST", "/api/login", {"email": "livreur@manjeo.test", "password": "ManjeoDemo2026!"})
            request("PATCH", "/api/courier/profile", {"online": True}, courier_cookie)
            claimed, _ = request("POST", "/api/orders/MJ-LEGACY002/claim", {}, courier_cookie)
            self.assertNotIn("deliveryCode", claimed["order"])
            request("PATCH", "/api/orders/MJ-LEGACY002", {"status": "picked_up"}, courier_cookie)
            delivered, _ = request("PATCH", "/api/orders/MJ-LEGACY002", {"status": "delivered", "deliveryCode": ready["deliveryCode"]}, courier_cookie)
            self.assertEqual(delivered["order"]["status"], "delivered")
            self.assertEqual(delivered["order"]["items"], ready["items"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()



class SQLiteLegacyMigrationTests(LegacyMigrationAssertions, unittest.TestCase):
    def test_upgrade_preserves_users_sessions_menu_order_and_is_repeatable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.sqlite3"
            with sqlite3.connect(path) as connection:
                expected = seed_legacy_database(connection)
            database = Database(path)
            self.assert_legacy_records_preserved(database, expected)
            database = Database(path)
            self.assert_legacy_records_preserved(database, expected)
            with database.connect() as connection:
                self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assert_legacy_ready_can_be_delivered(database)


@unittest.skipUnless(os.environ.get("MANJEO_TEST_DATABASE_URL"), "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresLegacyMigrationTests(LegacyMigrationAssertions, unittest.TestCase):
    def test_upgrade_preserves_users_sessions_menu_order_and_is_repeatable(self):
        import psycopg
        from psycopg import sql
        from server.postgres import PostgresConnection, PostgresDatabase
        dsn = os.environ["MANJEO_TEST_DATABASE_URL"]
        schema = "manjeo_test_" + uuid.uuid4().hex
        self.assertRegex(schema, r"^manjeo_test_[0-9a-f]{32}$")

        def drop_owned_schema():
            if not re.fullmatch(r"manjeo_test_[0-9a-f]{32}", schema):
                raise AssertionError("Refusing cleanup of an unowned schema")
            with psycopg.connect(dsn) as connection:
                connection.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))

        self.addCleanup(drop_owned_schema)
        with psycopg.connect(dsn) as connection:
            connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            connection.execute(sql.SQL("SET LOCAL search_path TO {}, pg_catalog").format(sql.Identifier(schema)))
            expected = seed_legacy_database(PostgresConnection(connection))
        self.assert_legacy_records_preserved(PostgresDatabase(dsn, schema=schema), expected)
        database = PostgresDatabase(dsn, schema=schema)
        self.assert_legacy_records_preserved(database, expected)
        self.assert_legacy_ready_can_be_delivered(database)


if __name__ == "__main__":
    unittest.main()
