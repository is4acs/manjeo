"""Payment contracts: fake Stripe only, temporary SQLite/optional owned PG schema."""
import hashlib
import hmac
import http.client
import io
import json
import os
import tempfile
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from server import payments
from server.app import APIError, Database, now_iso
from server.test_app import AppTestHarness


class PaymentContracts:
    def prepare(self):
        environment = patch.dict(os.environ, {"MANJEO_PAYMENT_MODE": "stripe_test", "STRIPE_SECRET_KEY": "sk_test_FixtureOnly",
                                               "STRIPE_WEBHOOK_SECRET": "whsec_FixtureOnly", "APP_ORIGIN": "https://payments.example.test"})
        environment.start()
        self.addCleanup(environment.stop)
        network = patch.object(payments, "stripe_request", side_effect=AssertionError("Real Stripe calls are forbidden in tests"))
        network.start()
        self.addCleanup(network.stop)
        with self.database.connect() as db:
            self.database.begin_write(db)
            payments.initialize_payments(db)
        self.order = self.new_order()

    def new_order(self, method="stripe", **fields):
        stamp = now_iso()
        order = {"id": "MJ-" + uuid.uuid4().hex[:12].upper(), "customerId": "demo-client", "restaurantId": "ti-kreol",
                 "restaurant": "Ti Kaz Kréol", "status": "pending", "total": 2450, "date": stamp, "updatedAt": stamp,
                 "history": [{"status": "pending", "date": stamp}], "acceptBy": payments.future(stamp, 600),
                 "courierId": None, "courierName": None, "items": [{"price": 1100, "name": "Snapshot", "quantity": 2}], **fields}
        payments.prepare_order_payment(order, method)
        with self.database.connect() as db:
            self.database.begin_write(db)
            db.execute("INSERT INTO orders VALUES (?,?,?,?,?,?,?)", (order["id"], order["customerId"], "ti-kreol", str(uuid.uuid4()), "hash", stamp, json.dumps(order)))
            db.execute("INSERT INTO order_assignments VALUES (?,?,?)", (order["id"], None, order["status"]))
            payments.register_payment(db, order)
        return order

    def handler(self, role="client", user_id=None):
        def user(db, roles):
            if role not in roles:
                raise APIError(403, "Accès interdit.")
            return {"id": user_id or "demo-" + role, "role": role}
        return SimpleNamespace(state=SimpleNamespace(database=self.database), user=user, command="POST", headers={})

    def records(self, order=None):
        order = order or self.order
        with self.database.connect() as db:
            current = json.loads(db.execute("SELECT data FROM orders WHERE id=?", (order["id"],)).fetchone()["data"])
            payment = db.execute("SELECT * FROM order_payments WHERE order_id=?", (order["id"],)).fetchone()
            return current, dict(payment) if payment else None

    def session(self, order=None, **fields):
        _, row = self.records(order)
        return {"id": "cs_test_" + row["payment_id"], "object": "checkout.session", "livemode": False, "mode": "payment",
                "amount_total": row["amount"], "currency": "eur", "metadata": payments.metadata(row),
                "client_reference_id": row["order_id"], "status": "open", "payment_status": "unpaid",
                "url": "https://checkout.stripe.com/c/pay/cs_test_" + row["payment_id"], **fields}

    def event(self, obj=None, kind="checkout.session.completed", **fields):
        return {"id": "evt_" + uuid.uuid4().hex, "object": "event", "type": kind, "livemode": False,
                "data": {"object": obj or self.session(status="complete", payment_status="paid", payment_intent="pi_" + uuid.uuid4().hex)}, **fields}

    def deliver(self, event):
        raw = json.dumps(event).encode()
        signature = self.signature(raw)
        return payments.apply_webhook(self.database, payments.verify_webhook(raw, signature))

    def signature(self, raw, timestamp=None):
        timestamp = int(time.time()) if timestamp is None else timestamp
        digest = hmac.new(b"whsec_FixtureOnly", str(timestamp).encode() + b"." + raw, hashlib.sha256).hexdigest()
        return "t=" + str(timestamp) + ",v1=" + digest

    def assert_api(self, status, function, *args):
        with self.assertRaises(APIError) as raised:
            function(*args)
        self.assertEqual(raised.exception.status, status)
        return raised.exception.message

    def cancel(self):
        with self.database.connect() as db:
            self.database.begin_write(db)
            order = json.loads(db.execute("SELECT data FROM orders WHERE id=?", (self.order["id"],)).fetchone()["data"])
            order["status"] = "cancelled"
            payments.cancel_payment(db, order)
            db.execute("UPDATE order_assignments SET state='cancelled' WHERE order_id=?", (order["id"],))

    def refund(self, status="succeeded", **fields):
        _, row = self.records()
        return {"id": "re_" + row["payment_id"], "object": "refund", "status": status, "metadata": payments.metadata(row),
                "payment_intent": row["payment_intent_id"], "currency": "eur", "amount": row["amount"], **fields}

    def test_configuration_never_exposes_keys_and_rejects_live_or_missing_keys(self):
        self.assertTrue(payments.configuration()["stripeAvailable"])
        self.assertNotIn("FixtureOnly", json.dumps(payments.configuration()))
        cases = [{"STRIPE_SECRET_KEY": ""}, {"STRIPE_SECRET_KEY": "sk_live_NotAllowed"}, {"STRIPE_WEBHOOK_SECRET": ""},
                 {"MANJEO_PAYMENT_MODE": "live"}, {"APP_ORIGIN": "https://evil.example/path"}, {"APP_ORIGIN": "https://[invalid"},
                 {"APP_ORIGIN": "http://payments.example.test"}]
        for values in cases:
            with self.subTest(values=tuple(values)), patch.dict(os.environ, values):
                self.assertFalse(payments.configuration()["stripeAvailable"])
                self.assert_api(503, payments.validate_requested_payment, {"paymentMethod": "stripe"})
                self.assertEqual(payments.validate_requested_payment({}), "demo")

    def test_simulation_and_restart_preserve_existing_order_snapshots(self):
        demo = self.new_order("demo")
        before, row = self.records(demo)
        self.assertIsNone(row)
        self.assertEqual(before["status"], "pending")
        self.assertEqual(before["payment"]["status"], "simulated")
        with self.database.connect() as db:
            payments.initialize_payments(db)
            payments.initialize_payments(db)
        self.assertEqual(self.records(demo)[0], before)

    def test_stripe_order_is_not_actionable_and_rejects_invalid_payment_modes_amounts(self):
        order, row = self.records()
        self.assertEqual(order["status"], "awaiting_payment")
        self.assertIsNone(order["acceptBy"])
        self.assertEqual(row["status"], "awaiting_payment")
        self.assertEqual(row["amount"], 2450)
        for value in [None, [], {}, "applepay", "live", True]:
            self.assert_api(400, payments.validate_requested_payment, {"paymentMethod": value})
        for amount in [True, 1.5, 0, 49, 100000000]:
            self.assert_api(400, payments.prepare_order_payment, {**order, "total": amount}, "stripe")

    def test_checkout_enforces_owner_role_and_never_accepts_card_details(self):
        for role in ["admin", "restaurant", "courier"]:
            self.assert_api(403, payments.create_checkout, self.handler(role), self.order["id"], {})
        self.assert_api(404, payments.create_checkout, self.handler(user_id="other-client"), self.order["id"], {})
        self.assert_api(400, payments.create_checkout, self.handler(), self.order["id"], {"number": "not-a-card"})

    def test_checkout_uses_immutable_server_total_metadata_and_no_write_lock_over_network(self):
        seen = []
        def stripe(method, path, params, key):
            with self.database.connect() as db:
                self.database.begin_write(db)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 1)
            seen.append((method, path, params, key))
            return self.session()
        with patch.object(payments, "stripe_request", side_effect=stripe):
            first = payments.create_checkout(self.handler(), self.order["id"], {"language": "ht"})
            replay = payments.create_checkout(self.handler(), self.order["id"], {"language": "pt"})
        self.assertEqual(first, replay)
        self.assertEqual(len(seen), 1)
        parameters = seen[0][2]
        self.assertEqual(parameters["line_items[0][price_data][unit_amount]"], 2450)
        self.assertEqual(parameters["payment_method_types[0]"], "card")
        self.assertEqual(parameters["locale"], "fr")
        self.assertEqual(parameters["payment_intent_data[metadata][order_id]"], self.order["id"])
        self.assertEqual(self.records()[0]["status"], "awaiting_payment")

    def test_checkout_after_expiry_persists_cancellation_and_releases_promo(self):
        with self.database.connect() as db:
            self.database.begin_write(db)
            db.execute("UPDATE order_payments SET expires_at=? WHERE order_id=?", (int(time.time()) - 1, self.order["id"]))
            db.execute("INSERT INTO promo_uses VALUES (?,?,?,?)", (self.order["id"], "BIENVENUE", "demo-client", self.order["date"]))
        self.assert_api(409, payments.create_checkout, self.handler(), self.order["id"], {})
        order, row = self.records()
        self.assertEqual((order["status"], row["status"]), ("cancelled", "expired"))
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT state FROM order_assignments WHERE order_id=?", (self.order["id"],)).fetchone()[0], "cancelled")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM promo_uses WHERE order_id=?", (self.order["id"],)).fetchone()[0], 0)

    def test_checkout_response_arriving_after_expiry_never_returns_a_payment_link(self):
        with patch.object(payments, "stripe_request", side_effect=APIError(503, "Timeout fictif")):
            self.assert_api(503, payments.create_checkout, self.handler(), self.order["id"], {})
        expires_at = self.records()[1]["expires_at"]
        clock = [expires_at - 1]
        paths = []
        def stripe(method, path, parameters, key):
            paths.append(path)
            if path.endswith("/expire"):
                return {}
            session = self.session()
            clock[0] = expires_at + 1
            return session
        with patch.object(payments.time, "time", side_effect=lambda: clock[0]), patch.object(payments, "stripe_request", side_effect=stripe):
            self.assert_api(409, payments.create_checkout, self.handler(), self.order["id"], {})
        order, row = self.records()
        self.assertEqual((order["status"], row["status"]), ("cancelled", "expired"))
        self.assertEqual(paths, ["/checkout/sessions", "/checkout/sessions/" + row["session_id"] + "/expire"])

    def test_checkout_network_retry_and_concurrency_keep_identical_idempotency_key_and_parameters(self):
        seen = []
        def outage(method, path, params, key):
            seen.append((params, key))
            raise APIError(503, "Outage")
        with patch.object(payments, "stripe_request", side_effect=outage):
            self.assert_api(503, payments.create_checkout, self.handler(), self.order["id"], {"language": "pt"})
        barrier = threading.Barrier(2)
        def stripe(method, path, params, key):
            seen.append((params, key))
            barrier.wait(timeout=10)
            return self.session()
        with patch.object(payments, "stripe_request", side_effect=stripe), ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(payments.create_checkout, self.handler(), self.order["id"], {"language": language}) for language in ["fr", "ht"]]
            results = [future.result(timeout=15) for future in futures]
        self.assertEqual(results[0], results[1])
        self.assertTrue(all(item == seen[0] for item in seen))
        self.assertEqual(seen[0][0]["locale"], "pt-BR")

    def test_checkout_rejects_forged_amount_foreign_metadata_live_session_and_redirect(self):
        for fields in [{"amount_total": 1}, {"amount_total": True}, {"metadata": {}}, {"livemode": True},
                       {"currency": "usd"}, {"url": "https://evil.example/payment"}, {"url": "https://[invalid"}, {"id": "cs_live_NotAllowed"}]:
            with self.subTest(fields=fields), patch.object(payments, "stripe_request", return_value=self.session(**fields)):
                with self.assertRaises(APIError):
                    payments.create_checkout(self.handler(), self.order["id"], {})
            self.assertIsNone(self.records()[1]["session_id"])
            self.assertEqual(self.records()[0]["status"], "awaiting_payment")

    def test_cancellation_during_checkout_keeps_session_association_but_never_returns_payment_url(self):
        calls = []
        def stripe(method, path, params, key):
            calls.append(path)
            if path.endswith("/expire"):
                return self.session(status="expired")
            session = self.session()
            self.cancel()
            return session
        with patch.object(payments, "stripe_request", side_effect=stripe):
            self.assert_api(409, payments.create_checkout, self.handler(), self.order["id"], {})
        order, row = self.records()
        self.assertEqual(order["status"], "cancelled")
        self.assertIsNotNone(row["session_id"])
        self.assertTrue(calls[-1].endswith("/expire"))

    def test_signature_requires_unmodified_body_recent_timestamp_and_test_mode(self):
        raw = json.dumps(self.event()).encode()
        signature = self.signature(raw)
        self.assertEqual(payments.verify_webhook(raw, signature)["object"], "event")
        self.assert_api(400, payments.verify_webhook, raw + b" ", signature)
        self.assert_api(400, payments.verify_webhook, raw, "")
        self.assert_api(400, payments.verify_webhook, raw, self.signature(raw, int(time.time()) - 301))
        self.assert_api(400, payments.verify_webhook, raw, self.signature(raw, int(time.time()) + 301))
        self.assert_api(400, payments.verify_webhook, raw, signature + ",t=" + str(int(time.time())))
        self.assert_api(400, payments.verify_webhook, b"x" * (payments.MAX_WEBHOOK_BYTES + 1), signature)
        live = json.dumps(self.event(livemode=True)).encode()
        self.assert_api(400, payments.verify_webhook, live, self.signature(live))
        nested = b'{"data":' + b'[' * 10000 + b'0' + b']' * 10000 + b'}'
        self.assert_api(400, payments.verify_webhook, nested, self.signature(nested))
        for character in ("\x00", "\ud800", "\udfff"):
            invalid = self.event()
            invalid["extra"] = [{"value": character}]
            invalid_raw = json.dumps(invalid).encode()
            self.assert_api(400, payments.verify_webhook, invalid_raw, self.signature(invalid_raw))
        self.assertEqual(payments.verify_webhook(raw, signature + ",v1=" + "0" * 64)["object"], "event")

    def test_only_verified_paid_webhook_opens_kitchen_and_starts_ten_minute_deadline(self):
        before = self.records()[0]
        event = self.event()
        self.deliver(event)
        paid, row = self.records()
        self.assertEqual((paid["status"], row["status"]), ("pending", "paid"))
        self.assertEqual(payments.epoch(paid["acceptBy"]) - payments.epoch(paid["updatedAt"]), 600)
        self.assertEqual(paid["items"], before["items"])
        self.assertEqual(paid["total"], before["total"])
        self.assertEqual(len(paid["history"]), 2)
        self.assertTrue(self.deliver(event)["duplicate"])
        self.assertEqual(self.records()[0], paid)

    def test_webhook_acceptance_deadline_starts_after_waiting_for_the_write_lock(self):
        event = self.event()
        arrival = now_iso()
        acquired = payments.future(arrival, 9)
        locked = [False]
        begin_write = self.database.begin_write
        def delayed_lock(db):
            begin_write(db)
            locked[0] = True
        with patch.object(self.database, "begin_write", side_effect=delayed_lock), patch.object(
                payments, "now_iso", side_effect=lambda: acquired if locked[0] else arrival):
            self.deliver(event)
        order = self.records()[0]
        self.assertEqual(order["acceptBy"], payments.future(acquired, 600))
        self.assertEqual(order["history"][-1]["date"], acquired)

    def test_unpaid_completion_foreign_schema_and_unknown_events_do_not_activate_order(self):
        self.deliver(self.event(self.session(status="complete", payment_status="unpaid")))
        foreign = self.session(status="complete", payment_status="paid", payment_intent="pi_foreign")
        foreign["metadata"]["payment_id"] = uuid.uuid4().hex
        self.assertTrue(self.deliver(self.event(foreign))["ignored"])
        self.assertTrue(self.deliver(self.event(kind="payment_intent.succeeded"))["ignored"])
        self.assertEqual(self.records()[0]["status"], "awaiting_payment")

    def test_webhook_mismatches_fail_without_consuming_event_or_mutating_order(self):
        before = self.records()
        for fields in [{"amount_total": 999}, {"currency": "usd"}, {"client_reference_id": "MJ-000000000000"},
                       {"livemode": True}, {"payment_intent": None}, {"status": "open"}]:
            obj = self.session(status="complete", payment_status="paid", payment_intent="pi_fixture")
            obj.update(fields)
            with self.subTest(fields=fields):
                self.assert_api(400, self.deliver, self.event(obj))
            self.assertEqual(self.records(), before)
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM payment_events").fetchone()[0], 0)

    def test_concurrent_duplicate_webhook_only_unlocks_once(self):
        event = self.event()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.deliver, [event, event]))
        self.assertEqual(sum(result.get("duplicate", False) for result in results), 1)
        self.assertEqual(len(self.records()[0]["history"]), 2)

    def test_expiry_cancels_waiting_order_and_late_payment_requires_refund(self):
        stamp = payments.future(self.order["date"], payments.CHECKOUT_SECONDS + 1)
        with self.database.connect() as db:
            self.database.begin_write(db)
            db.execute("INSERT INTO promo_uses VALUES (?,?,?,?)", (self.order["id"], "BIENVENUE", "demo-client", self.order["date"]))
            payments.expire_awaiting_payments(db, stamp)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM promo_uses WHERE order_id=?", (self.order["id"],)).fetchone()[0], 0)
        order, row = self.records()
        self.assertEqual((order["status"], row["status"]), ("cancelled", "expired"))
        self.deliver(self.event())
        order, row = self.records()
        self.assertEqual((order["status"], row["status"]), ("cancelled", "refund_pending"))
        self.assertIsNone(order["acceptBy"])

    def test_expiration_event_cannot_undo_confirmed_payment(self):
        self.deliver(self.event())
        before = self.records()[0]
        self.deliver(self.event(self.session(status="expired", payment_status="unpaid"), kind="checkout.session.expired"))
        self.assertEqual(self.records()[0], before)

    def test_paid_cancellation_marks_refund_pending_and_paid_replays_do_not_resurrect(self):
        event = self.event()
        self.deliver(event)
        self.cancel()
        event["id"] = "evt_" + uuid.uuid4().hex
        self.deliver(event)
        order, row = self.records()
        self.assertEqual((order["status"], row["status"]), ("cancelled", "refund_pending"))

    def test_refund_is_admin_only_idempotent_and_confirmed_only_by_webhook(self):
        self.deliver(self.event())
        self.assert_api(409, payments.request_refund, self.handler("admin"), self.order["id"])
        self.cancel()
        for role in ["client", "restaurant", "courier"]:
            self.assert_api(403, payments.request_refund, self.handler(role), self.order["id"])
        receipt = self.refund()
        with patch.object(payments, "stripe_request", return_value=receipt) as stripe:
            response = payments.request_refund(self.handler("admin"), self.order["id"])
            payments.request_refund(self.handler("admin"), self.order["id"])
        self.assertEqual(stripe.call_count, 1)
        self.assertEqual(response["payment"]["status"], "refund_pending")
        self.deliver(self.event(receipt, kind="refund.updated"))
        self.assertEqual(self.records()[1]["status"], "refunded")
        self.deliver(self.event(self.refund(status="pending"), kind="refund.created"))
        self.assertEqual(self.records()[1]["status"], "refunded")

    def test_refund_network_failure_retries_same_key_and_failed_webhook_stays_visible(self):
        self.deliver(self.event())
        self.cancel()
        keys = []
        def stripe(method, path, parameters, key):
            keys.append(key)
            if len(keys) == 1:
                raise APIError(503, "Temporary outage")
            return self.refund(status="pending")
        with patch.object(payments, "stripe_request", side_effect=stripe):
            self.assert_api(503, payments.request_refund, self.handler("admin"), self.order["id"])
            payments.request_refund(self.handler("admin"), self.order["id"])
        self.assertEqual(keys[0], keys[1])
        self.deliver(self.event(self.refund(status="failed"), kind="refund.failed"))
        self.deliver(self.event(self.refund(status="pending"), kind="refund.created"))
        self.assertEqual(self.records()[1]["status"], "refund_failed")
        self.assert_api(409, payments.request_refund, self.handler("admin"), self.order["id"])

    def test_refund_rejects_wrong_amount_and_never_confirms_an_active_order(self):
        self.deliver(self.event())
        self.assert_api(409, self.deliver, self.event(self.refund(), kind="refund.updated"))
        self.cancel()
        self.assert_api(400, self.deliver, self.event(self.refund(amount=1), kind="refund.updated"))
        self.assertEqual(self.records()[1]["status"], "refund_pending")
        for status in ([], {}, None, True):
            self.assert_api(400, self.deliver, self.event(self.refund(status=status), kind="refund.updated"))
            self.assertEqual(self.records()[1]["status"], "refund_pending")


class PaymentTests(PaymentContracts, unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.database = Database(Path(directory.name) / "payments.sqlite3")
        self.prepare()


@unittest.skipUnless(os.environ.get("MANJEO_TEST_DATABASE_URL"), "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresPaymentTests(PaymentContracts, unittest.TestCase):
    def setUp(self):
        from server.postgres import PostgresDatabase
        import psycopg
        from psycopg import sql
        schema = "manjeo_test_" + uuid.uuid4().hex
        dsn = os.environ["MANJEO_TEST_DATABASE_URL"]
        def clean():
            with psycopg.connect(dsn) as db:
                db.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
        self.addCleanup(clean)
        self.database = PostgresDatabase(dsn, schema=schema)
        self.prepare()


class PaymentTransportTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"MANJEO_PAYMENT_MODE": "stripe_test", "STRIPE_SECRET_KEY": "sk_test_FixtureOnly",
                                                   "STRIPE_WEBHOOK_SECRET": "whsec_FixtureOnly", "APP_ORIGIN": "https://payments.example.test"})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_stripe_transport_has_fixed_origin_timeout_version_and_idempotency_header(self):
        def open_request(request, timeout):
            self.assertEqual(request.full_url, "https://api.stripe.com/v1/checkout/sessions")
            self.assertEqual(request.headers["Stripe-version"], payments.STRIPE_VERSION)
            self.assertEqual(request.headers["Idempotency-key"], "stable-test-key")
            self.assertEqual(timeout, 8)
            self.assertIn(b"mode=payment", request.data)
            return io.BytesIO(b'{"object":"checkout.session","livemode":false}')
        with patch.object(payments, "build_opener") as builder:
            builder.return_value.open.side_effect = open_request
            self.assertEqual(payments.stripe_request("POST", "/checkout/sessions", {"mode": "payment"}, "stable-test-key")["object"], "checkout.session")
        self.assertIsNone(payments.NoRedirect().redirect_request(None, None, 302, "", {}, "https://untrusted.example"))

    def test_transport_rejects_provider_errors_live_responses_and_unbounded_bodies_without_leaking(self):
        responses = [b'{"livemode":true}', b'[]', b'invalid', b'x' * (payments.MAX_RESPONSE_BYTES + 1),
                     b'{"data":' + b'[' * 10000 + b'0' + b']' * 10000 + b'}']
        for raw in responses:
            with patch.object(payments, "build_opener") as builder:
                builder.return_value.open.return_value = io.BytesIO(raw)
                with self.assertRaises(APIError) as error:
                    payments.stripe_request("POST", "/checkout/sessions", {}, "test")
                self.assertEqual(error.exception.status, 503)
        for cause in [URLError("sk_test_DoNotExpose"), HTTPError("https://api.stripe.com", 500, "sk_test_DoNotExpose", {}, None), TimeoutError(),
                      http.client.IncompleteRead(b"sk_test_DoNotExpose", 40), http.client.BadStatusLine("sk_test_DoNotExpose")]:
            with patch.object(payments, "build_opener") as builder:
                builder.return_value.open.side_effect = cause
                with self.assertRaises(APIError) as error:
                    payments.stripe_request("POST", "/checkout/sessions", {}, "test")
                self.assertNotIn("sk_test", error.exception.message)


class PaymentHTTPContracts:
    def configure_http_payments(self):
        self.environment = patch.dict(os.environ, {"MANJEO_PAYMENT_MODE": "stripe_test", "STRIPE_SECRET_KEY": "sk_test_FixtureOnly",
                                                   "STRIPE_WEBHOOK_SECRET": "whsec_FixtureOnly", "APP_ORIGIN": "https://payments.example.test"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.network = patch.object(payments, "stripe_request", side_effect=AssertionError("Real Stripe calls are forbidden in tests"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def stripe_order(self):
        payload = self.order_payload()
        payload["paymentMethod"] = "stripe"
        return self.create_order(payload), payload

    def payment_record(self, order):
        with self.database.connect() as db:
            return dict(db.execute("SELECT * FROM order_payments WHERE order_id=?", (order["id"],)).fetchone())

    def signed_paid(self, order, kind="checkout.session.completed"):
        row = self.payment_record(order)
        obj = {"id": "cs_test_" + row["payment_id"], "object": "checkout.session", "livemode": False, "mode": "payment",
               "amount_total": row["amount"], "currency": "eur", "metadata": payments.metadata(row), "client_reference_id": order["id"],
               "status": "complete", "payment_status": "paid", "payment_intent": "pi_" + row["payment_id"]}
        event = {"id": "evt_" + uuid.uuid4().hex, "object": "event", "livemode": False, "type": kind, "data": {"object": obj}}
        return event

    def webhook(self, event, signed=True, declared_length=None):
        raw = json.dumps(event, indent=2).encode()
        stamp = str(int(time.time()))
        digest = hmac.new(b"whsec_FixtureOnly", stamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
        headers = {"Content-Type": "application/json", "Origin": "https://api.stripe.com", "Content-Length": str(len(raw) if declared_length is None else declared_length)}
        if signed:
            headers["Stripe-Signature"] = "t=" + stamp + ",v1=" + digest
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        connection.request("POST", "/api/payments/stripe/webhook", raw, headers)
        response = connection.getresponse()
        body = json.loads(response.read())
        status = response.status
        connection.close()
        return status, body

    def test_http_unconfigured_stripe_refuses_creation_but_explicit_simulation_survives(self):
        self.login("client")
        payload = self.order_payload()
        payload["paymentMethod"] = "stripe"
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY": ""}):
            self.assertFalse(self.request("GET", "/api/payments/config")[0]["stripeAvailable"])
            self.request("POST", "/api/orders", payload, role="client", status=503)
            self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["orders"], [])
            payload["paymentMethod"] = "demo"
            order = self.request("POST", "/api/orders", payload, role="client", status=201)[0]["order"]
            self.assertEqual(order["payment"]["status"], "simulated")

    def test_http_waiting_order_is_invisible_to_kitchen_and_rejects_four_role_shortcuts(self):
        order, _ = self.stripe_order()
        for role in ["restaurant", "admin", "courier"]:
            self.login(role)
        self.assertEqual(self.request("GET", "/api/orders", role="restaurant")[0]["orders"], [])
        self.assertEqual(self.request("GET", "/api/orders", role="admin")[0]["orders"][0]["status"], "awaiting_payment")
        self.request("PATCH", "/api/courier/profile", {"online": True}, role="courier")
        self.assertEqual(self.request("GET", "/api/deliveries", role="courier")[0]["available"], [])
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "accepted"}, role="restaurant", status=403)
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "accepted"}, role="admin", status=409)
        self.request("POST", "/api/orders/" + order["id"] + "/claim", {}, role="courier", status=409)
        self.request("POST", "/api/orders/" + order["id"] + "/checkout", {}, role="admin", status=403)
        self.request("POST", "/api/orders/" + order["id"] + "/checkout", {}, status=401)
        self.request("POST", "/api/orders/" + order["id"] + "/messages", {"body": "Trop tôt"}, role="client", status=409)

    def test_http_unpaid_order_thread_messages_translations_and_badges_are_private(self):
        order, _ = self.stripe_order()
        self.login("restaurant")
        path = "/api/orders/" + order["id"]
        message_id = uuid.uuid4().hex
        # A historical/imported message must not bypass the order's payment
        # visibility through either the badge aggregate or translation cache.
        with self.database.connect() as db:
            self.database.begin_write(db)
            db.execute("INSERT INTO order_messages VALUES (?,?,?,?,?,?,?,?,?)",
                       (message_id, order["id"], "demo-admin", "admin", "Assistance", "Message de test", "fr", "", order["date"]))
        with patch("server.translation.provider_config") as provider:
            for state in ("awaiting_payment", "cancelled", "late_payment_after_cancellation"):
                with self.subTest(state=state):
                    if state == "cancelled":
                        self.request("PATCH", path, {"status": "cancelled", "reason": "Paiement abandonné"}, role="client")
                    elif state == "late_payment_after_cancellation":
                        self.assertEqual(self.webhook(self.signed_paid(order))[0], 200)
                    listed = self.request("GET", "/api/orders", role="restaurant")[0]
                    self.assertEqual((listed["orders"], listed["unread"]), ([], {}))
                    self.request("GET", path + "/thread", role="restaurant", status=403)
                    self.request("POST", path + "/messages", {"body": "Accès refusé"}, role="restaurant", status=403)
                    self.request("POST", "/api/translate", {"orderId": order["id"], "messageId": message_id, "to": "ht"},
                                 role="restaurant", status=403)
                    with self.database.connect() as db:
                        self.assertEqual(db.execute("SELECT COUNT(*) FROM order_message_reads WHERE user_id='demo-restaurant'").fetchone()[0], 0)
                        self.assertEqual(db.execute("SELECT COUNT(*) FROM order_message_receipts WHERE user_id='demo-restaurant'").fetchone()[0], 0)
                        self.assertEqual(db.execute("SELECT COUNT(*) FROM translation_usage").fetchone()[0], 0)
                        self.assertEqual(db.execute("SELECT COUNT(*) FROM translation_cache").fetchone()[0], 0)
                        self.assertEqual(db.execute("SELECT COUNT(*) FROM order_messages").fetchone()[0], 1)
            provider.assert_not_called()
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["unread"], {order["id"]: 1})

    def test_http_paid_then_cancelled_order_keeps_thread_badges_and_exact_grace(self):
        order, _ = self.stripe_order()
        self.assertEqual(self.webhook(self.signed_paid(order))[0], 200)
        self.login("restaurant")
        path = "/api/orders/" + order["id"]
        self.request("PATCH", path, {"status": "accepted"}, role="restaurant")
        message = self.request("POST", path + "/messages", {"phraseId": "thanks"}, role="client", status=201)[0]["message"]
        self.request("PATCH", path, {"status": "cancelled", "reason": "Test après paiement et acceptation"}, role="restaurant")
        visible = self.request("GET", "/api/orders", role="restaurant")[0]
        self.assertEqual([row["id"] for row in visible["orders"]], [order["id"]])
        self.assertEqual(visible["unread"], {order["id"]: 1})
        thread = self.request("GET", path + "/thread", role="restaurant")[0]
        self.assertTrue(thread["open"])
        self.assertEqual([row["id"] for row in thread["messages"]], [message["id"]])
        self.assertEqual(self.request("GET", "/api/orders", role="restaurant")[0]["unread"], {})
        translated = self.request("POST", "/api/translate", {"orderId": order["id"], "messageId": message["id"], "to": "ht"}, role="restaurant")[0]
        self.assertEqual(translated["provider"], "phrases")
        self.request("POST", path + "/messages", {"body": "Annulation prise en compte"}, role="restaurant", status=201)
        with self.database.connect() as db:
            self.database.begin_write(db)
            current = json.loads(db.execute("SELECT data FROM orders WHERE id=?", (order["id"],)).fetchone()["data"])
            current["history"][-1]["date"] = payments.future(now_iso(), -1801)
            db.execute("UPDATE orders SET data=? WHERE id=?", (json.dumps(current), order["id"]))
        thread = self.request("GET", path + "/thread", role="restaurant")[0]
        self.assertFalse(thread["open"])
        self.assertEqual(len(thread["messages"]), 2)
        self.request("POST", path + "/messages", {"body": "Trop tard"}, role="restaurant", status=409)

    def test_http_raw_signed_webhook_without_browser_origin_unlocks_and_order_replay_is_current(self):
        order, payload = self.stripe_order()
        event = self.signed_paid(order)
        self.assertEqual(self.webhook(event, signed=False)[0], 400)
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["orders"][0]["status"], "awaiting_payment")
        self.assertEqual(self.webhook(event)[0], 200)
        self.assertTrue(self.webhook(event)[1]["duplicate"])
        replay = self.request("POST", "/api/orders", payload, role="client")[0]["order"]
        self.assertEqual(replay["payment"]["status"], "paid")
        self.assertEqual(replay["status"], "pending")
        self.login("restaurant")
        self.assertEqual(len(self.request("GET", "/api/orders", role="restaurant")[0]["orders"]), 1)
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "accepted"}, role="restaurant")
        self.assertEqual(self.webhook(event, declared_length=payments.MAX_WEBHOOK_BYTES + 1)[0], 413)

    def test_http_paid_acceptance_expiry_commits_refund_pending_even_when_acceptance_rejected(self):
        order, _ = self.stripe_order()
        self.assertEqual(self.webhook(self.signed_paid(order))[0], 200)
        with self.database.connect() as db:
            current = json.loads(db.execute("SELECT data FROM orders WHERE id=?", (order["id"],)).fetchone()["data"])
            current["acceptBy"] = "2020-01-01T00:00:00.000Z"
            db.execute("UPDATE orders SET data=? WHERE id=?", (json.dumps(current), order["id"]))
        self.login("restaurant")
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "accepted"}, role="restaurant", status=409)
        current = self.request("GET", "/api/orders", role="client")[0]["orders"][0]
        self.assertEqual((current["status"], current["payment"]["status"]), ("cancelled", "refund_pending"))

    def test_http_client_can_cancel_waiting_order_and_late_paid_event_never_reopens_it(self):
        order, _ = self.stripe_order()
        event = self.signed_paid(order)
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "cancelled", "reason": "Abandon test"}, role="client")
        self.assertEqual(self.webhook(event)[0], 200)
        current = self.request("GET", "/api/orders", role="client")[0]["orders"][0]
        self.assertEqual((current["status"], current["payment"]["status"]), ("cancelled", "refund_pending"))
        self.login("restaurant")
        self.assertEqual(self.request("GET", "/api/orders", role="restaurant")[0]["orders"], [])

    def test_http_hosted_checkout_and_admin_refund_keep_origin_guard_and_wait_for_webhooks(self):
        order, _ = self.stripe_order()
        path = "/api/orders/" + order["id"]
        paid_event = self.signed_paid(order)
        session = {**paid_event["data"]["object"], "status": "open", "payment_status": "unpaid", "payment_intent": None,
                   "url": "https://checkout.stripe.com/c/pay/" + paid_event["data"]["object"]["id"]}
        self.request("POST", path + "/checkout", {}, role="client", headers={"Origin": "https://untrusted.example"}, status=403)
        with patch.object(payments, "stripe_request", return_value=session):
            checkout = self.request("POST", path + "/checkout", {"language": "pt"}, role="client")[0]
        self.assertEqual(checkout["checkoutUrl"], session["url"])
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["orders"][0]["payment"]["status"], "awaiting_payment")
        self.assertEqual(self.webhook(paid_event)[0], 200)
        self.request("PATCH", path, {"status": "cancelled", "reason": "Remboursement test"}, role="client")
        self.request("POST", path + "/refund", {}, role="client", status=403)
        self.login("admin")
        row = self.payment_record(order)
        refund = {"id": "re_" + row["payment_id"], "object": "refund", "status": "succeeded", "metadata": payments.metadata(row),
                  "payment_intent": row["payment_intent_id"], "currency": "eur", "amount": row["amount"]}
        with patch.object(payments, "stripe_request", return_value=refund) as stripe:
            response = self.request("POST", path + "/refund", {}, role="admin")[0]
            self.request("POST", path + "/refund", {}, role="admin")
        self.assertEqual(stripe.call_count, 1)
        self.assertEqual(response["payment"]["status"], "refund_pending")
        event = {"id": "evt_" + uuid.uuid4().hex, "object": "event", "livemode": False, "type": "refund.updated", "data": {"object": refund}}
        self.assertEqual(self.webhook(event)[0], 200)
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["orders"][0]["payment"]["status"], "refunded")

    def test_http_late_refund_does_not_reopen_the_cancelled_orders_conversation(self):
        order, _ = self.stripe_order()
        path = "/api/orders/" + order["id"]
        self.assertEqual(self.webhook(self.signed_paid(order))[0], 200)
        self.login("restaurant")
        self.request("PATCH", path, {"status": "accepted"}, role="restaurant")
        self.request("POST", path + "/messages", {"body": "Votre commande est acceptée."}, role="restaurant", status=201)
        self.login("admin")
        self.request("PATCH", path, {"status": "cancelled", "reason": "Annulation de test après acceptation"}, role="admin")
        with self.database.connect() as db:
            self.database.begin_write(db)
            current = json.loads(db.execute("SELECT data FROM orders WHERE id=?", (order["id"],)).fetchone()["data"])
            current["updatedAt"] = payments.future(now_iso(), -1801)
            current["history"][-1]["date"] = current["updatedAt"]
            db.execute("UPDATE orders SET data=? WHERE id=?", (json.dumps(current), order["id"]))
        self.assertFalse(self.request("GET", path + "/thread", role="client")[0]["open"])
        row = self.payment_record(order)
        refund = {"id": "re_" + row["payment_id"], "object": "refund", "status": "succeeded", "metadata": payments.metadata(row),
                  "payment_intent": row["payment_intent_id"], "currency": "eur", "amount": row["amount"]}
        event = {"id": "evt_" + uuid.uuid4().hex, "object": "event", "livemode": False, "type": "refund.updated", "data": {"object": refund}}
        self.assertEqual(self.webhook(event)[0], 200)
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["orders"][0]["payment"]["status"], "refunded")
        for role in ("client", "restaurant", "admin"):
            thread = self.request("GET", path + "/thread", role=role)[0]
            self.assertFalse(thread["open"], "Le remboursement ne redémarre pas la fenêtre de messagerie")
            self.assertEqual(len(thread["messages"]), 1)
            self.request("POST", path + "/messages", {"body": "Message tardif"}, role=role, status=409)


class PaymentHTTPTests(PaymentHTTPContracts, AppTestHarness):
    def setUp(self):
        super().setUp()
        self.configure_http_payments()


@unittest.skipUnless(os.environ.get("MANJEO_TEST_DATABASE_URL"), "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresPaymentHTTPTests(PaymentHTTPContracts, AppTestHarness):
    from server.test_postgres import PostgresIntegrationTests as _Harness
    tearDown = _Harness.tearDown
    close_server = _Harness.close_server
    drop_owned_schema = _Harness.drop_owned_schema

    def setUp(self):
        self._Harness.setUp(self)
        self.configure_http_payments()


if __name__ == "__main__":
    unittest.main()
