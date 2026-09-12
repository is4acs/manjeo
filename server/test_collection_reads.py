"""Collection reads preserve exact projections without per-row SQL round trips."""
import copy
import hashlib
import json
import os
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from server.app import now_iso
from server.marketplace import courier_profile
from server.test_app import AppTestHarness


class CollectionReadContracts:
    def setup_collections(self):
        self.login("client")
        self.login("admin")
        template = self.create_order()
        self.request("PATCH", "/api/orders/" + template["id"],
                     {"status": "cancelled", "reason": "Préparation des fixtures"}, role="client")
        with self.database.connect() as db:
            self.database.begin_write(db)
            seed = db.execute("SELECT * FROM users WHERE id='demo-courier'").fetchone()
            for index in range(1, 50):
                identifier = "fleet-%02d" % index
                name = "Même nom" if index % 5 == 0 else "Livreur %02d" % index
                db.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?)", (
                    identifier, identifier + "@example.test", name, "courier", None,
                    seed["password_salt"], seed["password_hash"],
                ))
                if index % 3:
                    db.execute("INSERT INTO courier_profiles VALUES (?,?)", (identifier, index % 2))
            restaurants = db.execute("SELECT * FROM restaurants ORDER BY id").fetchall()
            for index, row in enumerate(restaurants):
                db.execute("UPDATE restaurants SET sort_order=?,accepting_orders=? WHERE id=?",
                           (index % 3 - 1, index % 2, row["id"]))
                products = db.execute("SELECT * FROM products WHERE restaurant_id=? ORDER BY id",
                                      (row["id"],)).fetchall()
                for position, product in enumerate(products):
                    data = json.loads(product["data"])
                    data["archived"] = index == 0 or position == 0
                    data["price"] += position * 31
                    data["name"] = "Produit modifié e\u0301 🥘 " + str(position)
                    db.execute("UPDATE products SET data=?,sort_order=?,available=? WHERE id=?", (
                        json.dumps(data), position % 2, int(position % 2 == 0), product["id"],
                    ))
            # Keep complete, immutable order snapshots despite catalog edits.
            # One courier also has terminal history alongside an active mission.
            states = ("accepted", "preparing", "ready", "picked_up", "delivered", "cancelled",
                      "delivered", "cancelled")
            for index, status in enumerate(states):
                order_id = "MJ-C011EC%06X" % index
                courier_number = index + 1 if index < 6 else 1
                order = copy.deepcopy(template)
                order.update(id=order_id, status=status, courierId="fleet-%02d" % courier_number,
                             courierName="Livreur %02d" % courier_number, updatedAt=now_iso(), acceptBy=None)
                stages = ["pending", "accepted", "preparing", "ready", "picked_up", "delivered"]
                stages = ["pending", "cancelled"] if status == "cancelled" else stages[:stages.index(status) + 1]
                order["history"] = [{"status": stage, "date": order["updatedAt"]} for stage in stages]
                db.execute("INSERT INTO orders VALUES (?,?,?,?,?,?,?)", (
                    order_id, "demo-client", "ti-kreol", "fixture-" + str(index), "fixture",
                    order["updatedAt"], json.dumps(order),
                ))
                db.execute("INSERT INTO order_assignments VALUES (?,?,?)", (order_id, order["courierId"], status))

    def fingerprint(self):
        """Detect writes without including private fixture fields in test output."""
        with self.database.connect() as db:
            result = {}
            for table in ("users", "courier_profiles", "orders", "order_assignments", "restaurants", "products"):
                rows = sorted(json.dumps(dict(row), sort_keys=True) for row in db.execute("SELECT * FROM " + table))
                result[table] = hashlib.sha256(json.dumps(rows).encode()).hexdigest()
            return result

    def measured_get(self, path, role=None, status=200):
        original = self.database.connect
        statements = []

        class Connection:
            def __init__(self, connection):
                self.connection = connection

            def execute(self, statement, parameters=()):
                statements.append(statement)
                return self.connection.execute(statement, parameters)

        @contextmanager
        def connect():
            with original() as db:
                yield Connection(db)

        with patch.object(self.database, "connect", connect):
            response = self.request("GET", path, role=role, status=status,
                                    headers={"X-Manjeo-Account": "demo-" + role} if role else None)[0]
        return response, statements

    def test_catalog_collection_matches_exact_individual_projection_with_two_queries(self):
        with self.database.connect() as db:
            expected = [self.database.restaurant(db, row)
                        for row in db.execute("SELECT * FROM restaurants ORDER BY sort_order,id")]
        before = self.fingerprint()
        response, queries = self.measured_get("/api/restaurants")
        self.assertEqual(response, {"restaurants": expected})
        self.assertEqual(len(expected), 6)
        self.assertTrue(any(restaurant["products"] == [] and restaurant["from"] == 0 for restaurant in expected))
        self.assertEqual(self.fingerprint(), before)
        self.assertEqual(len(queries), 2, "Catalog must fetch all restaurants and all products once")
        self.assertEqual(sum("FROM products" in query for query in queries), 1)

    def test_admin_fleet_matches_individual_profiles_and_queries_stay_bounded(self):
        with self.database.connect() as db:
            expected = [courier_profile(db, row)
                        for row in db.execute("SELECT * FROM users WHERE role='courier' ORDER BY name,id")]
        before = self.fingerprint()
        response, queries = self.measured_get("/api/couriers", "admin")
        self.assertEqual(response, {"couriers": expected})
        self.assertEqual(len(expected), 50)
        by_id = {row["id"]: row for row in expected}
        self.assertFalse(by_id["fleet-03"]["online"])
        self.assertIsNotNone(by_id["fleet-03"]["activeOrderId"])
        self.assertEqual(by_id["fleet-01"]["activeOrderId"], "MJ-C011EC000000")
        self.assertIsNone(by_id["fleet-05"]["activeOrderId"])
        self.assertIsNone(by_id["fleet-06"]["activeOrderId"])
        self.assertEqual(self.fingerprint(), before)
        self.assertLessEqual(len(queries), 8, "Fifty couriers must not need fifty profile and assignment queries")
        self.measured_get("/api/couriers", "client", status=403)
        self.assertEqual(self.fingerprint(), before)


class CollectionReadTests(CollectionReadContracts, AppTestHarness):
    def setUp(self):
        super().setUp()
        self.setup_collections()


@unittest.skipUnless(os.environ.get("MANJEO_TEST_DATABASE_URL"), "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresCollectionReadTests(CollectionReadContracts, AppTestHarness):
    from server.test_postgres import PostgresIntegrationTests as _Harness

    def setUp(self):
        self._Harness.setUp(self)
        self.setup_collections()

    tearDown = _Harness.tearDown
    close_server = _Harness.close_server
    drop_owned_schema = _Harness.drop_owned_schema
