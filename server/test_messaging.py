"""Profils, ouverture des coordonnées et messagerie de commande."""
import copy
import io
import json
import os
import http.client
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from server import messaging

from server.test_app import AppTestHarness


class MessagingContracts:
    def profile(self, role, **fields):
        return self.request("PATCH", "/api/profile", fields, role=role)[0]["user"]

    def accepted_order(self):
        order = self.create_order()
        self.login("restaurant")
        self.request("PATCH", "/api/orders/%s" % order["id"], {"status": "accepted"}, role="restaurant")
        return order

    def claimed_order(self):
        order = self.accepted_order()
        self.login("courier")
        self.request("PATCH", "/api/courier/profile", {"online": True}, role="courier")
        self.request("POST", "/api/orders/%s/claim" % order["id"], {}, role="courier", status=200)
        return order

    def conversation(self, order_id, role):
        return self.request("GET", "/api/orders/%s/thread" % order_id, role=role)[0]

    def test_profile_carries_contact_details_and_language(self):
        self.login("client")
        payload = self.request("GET", "/api/profile", role="client")[0]
        self.assertEqual(payload["user"]["phone"], "0694 00 00 01")
        self.assertIn({"code": "ht", "label": "Kreyòl ayisyen"}, payload["languages"])
        updated = self.profile("client", phone="0694 11 22 33", language="pt")
        self.assertEqual((updated["phone"], updated["language"]), ("0694 11 22 33", "pt"))
        self.assertEqual(self.request("GET", "/api/session", role="client")[0]["user"]["language"], "pt")
        self.request("PATCH", "/api/profile", {"phone": "12"}, role="client", status=400)
        self.request("PATCH", "/api/profile", {"language": "kr"}, role="client", status=400)
        self.request("PATCH", "/api/profile", {"role": "admin"}, role="client", status=400)

    def test_thread_opens_with_acceptance_and_closes_before_it(self):
        order = self.create_order()
        self.assertFalse(self.conversation(order["id"], "client")["open"])
        self.request("POST", "/api/orders/%s/messages" % order["id"], {"body": "Bonjour"}, role="client", status=409)
        self.accepted_order()
        accepted = self.request("GET", "/api/orders", role="client")[0]["orders"][0]
        self.assertTrue(self.conversation(accepted["id"], "client")["open"])
        self.request("POST", "/api/orders/%s/messages" % accepted["id"], {"body": "Je suis au 2e étage"}, role="client", status=201)
        thread = self.conversation(accepted["id"], "restaurant")
        self.assertEqual([message["body"] for message in thread["messages"]], ["Je suis au 2e étage"])
        self.assertEqual(thread["messages"][0]["senderRole"], "client")

    def test_only_the_people_on_the_order_can_read_the_thread(self):
        order = self.accepted_order()
        self.add_test_user("autre", "client")
        _, headers = self.request("POST", "/api/login", {"email": "autre@manjeo.test", "password": "ManjeoDemo2026!"})
        self.cookies["autre"] = headers["Set-Cookie"].split(";", 1)[0]
        self.request("GET", "/api/orders/%s/thread" % order["id"], role="autre", status=403)
        # Le livreur n'entre dans la conversation qu'une fois la course prise.
        self.login("courier")
        self.request("GET", "/api/orders/%s/thread" % order["id"], role="courier", status=403)
        self.request("PATCH", "/api/courier/profile", {"online": True}, role="courier")
        self.request("POST", "/api/orders/%s/claim" % order["id"], {}, role="courier")
        self.assertTrue(self.conversation(order["id"], "courier")["open"])

    def test_contacts_open_only_for_the_window_that_needs_them(self):
        order = self.claimed_order()
        # Le livreur affecté joint le client ; le client ne joint le livreur qu'au retrait.
        courier_view = self.conversation(order["id"], "courier")
        client_card = next(card for card in courier_view["contacts"] if card["role"] == "client")
        self.assertEqual(client_card["phone"], order["phone"])
        client_view = self.conversation(order["id"], "client")
        courier_card = next(card for card in client_view["contacts"] if card["role"] == "courier")
        self.assertEqual(courier_card["phone"], "")
        for status in ("preparing", "ready"):
            self.request("PATCH", "/api/orders/%s" % order["id"], {"status": status}, role="restaurant")
        courier_card = next(card for card in self.conversation(order["id"], "client")["contacts"] if card["role"] == "courier")
        self.assertEqual(courier_card["phone"], "0694 00 00 03")
        self.assertEqual(courier_card["language"], "ht")

    def test_quick_reply_is_stored_in_the_language_of_its_author(self):
        order = self.claimed_order()
        self.profile("courier", language="pt")
        self.request("POST", "/api/orders/%s/messages" % order["id"], {"phraseId": "on_my_way"}, role="courier", status=201)
        self.request("POST", "/api/orders/%s/messages" % order["id"], {"phraseId": "inconnu"}, role="courier", status=400)
        message = self.conversation(order["id"], "client")["messages"][0]
        self.assertEqual(message["language"], "pt")
        self.assertEqual(message["phraseId"], "on_my_way")
        self.assertIn("Estou a caminho", message["body"])
        # Le destinataire reçoit l'identifiant : son interface rend la phrase dans sa propre langue.
        phrases = {row["id"]: row["labels"] for row in self.request("GET", "/api/phrases")[0]["phrases"]}
        self.assertIn("Mwen sou wout", phrases["on_my_way"]["ht"])
        self.assertEqual(set(phrases["on_my_way"]), {"fr", "ht", "gcr", "pt", "en", "es", "zh"})

    def test_unread_messages_are_counted_for_the_other_side(self):
        order = self.claimed_order()
        self.request("POST", "/api/orders/%s/messages" % order["id"], {"phraseId": "downstairs"}, role="courier", status=201)
        counts = self.request("GET", "/api/orders", role="client")[0]["unread"]
        self.assertEqual(counts.get(order["id"]), 1)
        # Ses propres messages ne se comptent jamais, et la lecture remet le compteur à zéro.
        self.assertEqual(self.request("GET", "/api/orders", role="courier")[0]["unread"], {})
        self.conversation(order["id"], "client")
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["unread"], {})

    def test_translation_relay_says_plainly_that_no_engine_is_configured(self):
        self.login("client")
        with patch.dict(os.environ, {"MANJEO_TRANSLATE_URL": "", "MANJEO_TRANSLATE_KEY": ""}):
            self.request("POST", "/api/translate", {"text": "Bom dia", "from": "pt", "to": "ht"}, role="client", status=503)
        self.request("POST", "/api/translate", {"text": "Bom dia", "from": "pt", "to": "xx"}, role="client", status=400)

    def post(self, order, role, payload, status=201):
        return self.request("POST", "/api/orders/%s/messages" % order["id"], payload, role=role, status=status)[0]

    def test_unread_never_reveals_unrelated_order_ids(self):
        own = self.accepted_order()
        self.add_test_user("other-client", "client")
        self.login("other-client")
        other = self.create_order(self.order_payload("smash-club", "smash-classic", customer_id="test-other-client"), role="other-client")
        self.login("admin")
        self.request("PATCH", "/api/orders/" + other["id"], {"status": "accepted"}, role="admin")
        self.post(other, "other-client", {"body": "Message privé autre restaurant"})
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["unread"], {})
        self.assertEqual(self.request("GET", "/api/orders", role="restaurant")[0]["unread"], {})
        self.login("courier")
        self.assertEqual(self.request("GET", "/api/orders", role="courier")[0]["unread"], {})
        self.assertEqual(self.request("GET", "/api/orders", role="admin")[0]["unread"], {other["id"]: 1})
        self.post(own, "restaurant", {"body": "Votre commande est en préparation"})
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["unread"], {own["id"]: 1})

    def test_released_courier_loses_thread_post_replay_and_unread_access(self):
        order = self.claimed_order()
        payload = {"body": "Je viens au restaurant", "requestId": str(uuid.uuid4())}
        self.post(order, "courier", payload)
        self.post(order, "client", {"body": "Code du portail dans la conversation"})
        self.request("POST", "/api/orders/" + order["id"] + "/release", {"reason": "Incident avant retrait"}, role="courier")
        self.request("GET", "/api/orders/" + order["id"] + "/thread", role="courier", status=403)
        self.post(order, "courier", payload, status=403)
        self.assertEqual(self.request("GET", "/api/orders", role="courier")[0]["unread"], {})
        self.add_test_user("second-courier", "courier")
        self.login("second-courier")
        self.request("PATCH", "/api/courier/profile", {"online": True}, role="second-courier")
        self.request("POST", "/api/orders/" + order["id"] + "/claim", {}, role="second-courier")
        self.assertEqual(self.conversation(order["id"], "second-courier")["viewerId"], "test-second-courier")

    def test_cancellation_before_acceptance_never_opens_chat(self):
        order = self.create_order()
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "cancelled", "reason": "Erreur de commande"}, role="client")
        self.assertFalse(self.conversation(order["id"], "client")["open"])
        self.post(order, "client", {"body": "Ne doit pas rouvrir"}, status=409)
        self.login("admin")
        self.assertFalse(self.conversation(order["id"], "admin")["open"])

    def test_grace_period_closes_contacts_but_keeps_thread_readable(self):
        order = self.claimed_order()
        self.login("admin")
        self.post(order, "admin", {"body": "L’assistance suit cette commande"})
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "cancelled", "reason": "Annulation après acceptation"}, role="admin")
        for role in ("client", "restaurant", "courier"):
            thread = self.conversation(order["id"], role)
            self.assertTrue(thread["open"])
            self.assertTrue(all(not card["phone"] for card in thread["contacts"]))
            self.assertEqual(thread["messages"][0]["senderRole"], "admin")
        self.post(order, "client", {"body": "Merci pour votre assistance"})
        with self.database.connect() as db:
            record = json.loads(db.execute("SELECT data FROM orders WHERE id = ?", (order["id"],)).fetchone()[0])
            record["updatedAt"] = "2000-01-01T00:00:00.000Z"
            record["history"][-1]["date"] = record["updatedAt"]
            db.execute("UPDATE orders SET data = ? WHERE id = ?", (json.dumps(record), order["id"]))
        for role in ("client", "restaurant", "courier", "admin"):
            self.assertFalse(self.conversation(order["id"], role)["open"])
            self.post(order, role, {"body": "Trop tard"}, status=409)
        self.assertEqual(len(self.conversation(order["id"], "client")["messages"]), 2)
        admin_contacts = self.conversation(order["id"], "admin")["contacts"]
        self.assertEqual(next(card for card in admin_contacts if card["role"] == "client")["phone"], order["phone"])

    def test_delivery_contact_uses_order_snapshot_after_profile_change(self):
        order = self.claimed_order()
        self.profile("client", name="Nouveau nom de profil", phone="0694 99 88 77")
        contact = next(card for card in self.conversation(order["id"], "courier")["contacts"] if card["role"] == "client")
        self.assertEqual(contact["name"], order["customerName"])
        self.assertEqual(contact["phone"], order["phone"])

    def test_same_timestamp_new_message_stays_unread_and_sending_is_not_reading(self):
        order = self.accepted_order()
        stamp = messaging.now_iso()
        with patch("server.messaging.now_iso", return_value=stamp):
            self.post(order, "restaurant", {"body": "Premier message"})
            self.conversation(order["id"], "client")
            self.post(order, "restaurant", {"body": "Second message dans la même milliseconde"})
            self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["unread"], {order["id"]: 1})
            self.post(order, "client", {"body": "Message sans lecture préalable"})
            self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["unread"], {order["id"]: 1})
        with self.database.connect() as db:
            self.database.begin_write(db)
            messaging.initialize_messaging(db)
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["unread"], {order["id"]: 1})

    def test_sender_identity_distinguishes_accounts_with_the_same_role(self):
        order = self.accepted_order()
        self.add_test_user("second-restaurant", "restaurant", "ti-kreol")
        self.login("second-restaurant")
        self.post(order, "restaurant", {"body": "Un membre de l’équipe"})
        self.post(order, "second-restaurant", {"body": "Un autre membre"})
        messages = self.conversation(order["id"], "second-restaurant")["messages"]
        self.assertEqual({message["body"]: message["mine"] for message in messages},
                         {"Un membre de l’équipe": False, "Un autre membre": True})

    def test_previous_read_cursors_migrate_once_without_losing_unread_messages(self):
        order = self.accepted_order()
        with patch("server.messaging.now_iso", return_value="2026-01-01T10:00:00.000Z"):
            self.post(order, "restaurant", {"body": "Déjà lu avant migration"})
            self.conversation(order["id"], "client")
        with patch("server.messaging.now_iso", return_value="2026-01-01T10:00:01.000Z"):
            self.post(order, "restaurant", {"body": "Encore non lu"})
        with self.database.connect() as db:
            self.database.begin_write(db)
            # Reproduce the old messaging schema's persisted read state.
            db.execute("DELETE FROM order_message_receipts")
            db.execute("DELETE FROM messaging_migrations WHERE id = 'message-receipts-v1'")
            messaging.initialize_messaging(db)
            messaging.initialize_messaging(db)
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["unread"], {order["id"]: 1})
        self.assertEqual(len(self.conversation(order["id"], "client")["messages"]), 2)
        self.assertEqual(self.request("GET", "/api/orders", role="client")[0]["unread"], {})

    def test_message_request_id_is_atomic_and_conflicting_replay_is_rejected(self):
        order = self.accepted_order()
        payload = {"body": "Un seul envoi même après reconnexion", "requestId": str(uuid.uuid4())}
        barrier = threading.Barrier(2)
        def send(_):
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
            barrier.wait(timeout=10)
            connection.request("POST", "/api/orders/" + order["id"] + "/messages", json.dumps(payload),
                               {"Cookie": self.cookies["client"], "Content-Type": "application/json"})
            response = connection.getresponse()
            result = response.status, json.loads(response.read())
            connection.close()
            return result
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(send, range(2)))
        self.assertEqual(sorted(code for code, _ in results), [200, 201])
        self.assertEqual(results[0][1]["message"]["id"], results[1][1]["message"]["id"])
        replay = self.post(order, "client", {**payload, "requestId": payload["requestId"].upper()}, status=200)
        self.assertEqual(replay["message"]["id"], results[0][1]["message"]["id"])
        # Previously stored mixed-case identifiers remain the same request.
        with self.database.connect() as connection:
            connection.execute("UPDATE order_message_requests SET request_id = ? WHERE user_id = ?", (payload["requestId"].upper(), "demo-client"))
        replay = self.post(order, "client", payload, status=200)
        self.assertEqual(replay["message"]["id"], results[0][1]["message"]["id"])
        self.post(order, "client", {**payload, "body": "Autre contenu"}, status=409)
        self.assertEqual(len(self.conversation(order["id"], "client")["messages"]), 1)

    def test_invalid_types_and_ambiguous_payloads_are_400(self):
        order = self.accepted_order()
        for value in ([], {}, 3, None):
            self.request("PATCH", "/api/profile", {"language": value}, role="client", status=400)
            self.post(order, "client", {"phraseId": value}, status=400)
            self.request("POST", "/api/translate", {"text": "Bonjour", "from": value, "to": "en"}, role="client", status=400)
        for payload in ({"body": "Bonjour", "phraseId": "thanks"}, {"phraseId": ""}, {"body": "x" * 601}, {"body": "Bonjour", "requestId": "wrong"}):
            self.post(order, "client", payload, status=400)

    def test_translation_relay_handles_actual_provider_payload_and_invalid_responses(self):
        self.login("client")
        with patch.dict(os.environ, {"MANJEO_TRANSLATE_URL": "https://translation.example/translate", "MANJEO_TRANSLATE_KEY": "test-key"}):
            response = io.BytesIO(json.dumps({"translatedText": "Good morning"}).encode())
            with patch("urllib.request.urlopen", return_value=response) as relay:
                result = self.request("POST", "/api/translate", {"text": "Bonjour", "from": "fr", "to": "en"}, role="client")[0]
            self.assertEqual(result["text"], "Good morning")
            request = relay.call_args.args[0]
            body = json.loads(request.data)
            self.assertEqual(body, {"q": "Bonjour", "source": "fr", "target": "en", "format": "text", "api_key": "test-key"})
            for invalid in (b"[]", b"null", b"{invalid", json.dumps({"translatedText": ""}).encode(), b"x" * 100001):
                with patch("urllib.request.urlopen", return_value=io.BytesIO(invalid)):
                    self.request("POST", "/api/translate", {"text": "Bonjour", "from": "fr", "to": "en"}, role="client", status=502)
            for failure in (ConnectionResetError(), http.client.IncompleteRead(b"partial")):
                with patch("urllib.request.urlopen", side_effect=failure):
                    self.request("POST", "/api/translate", {"text": "Bonjour", "from": "fr", "to": "en"}, role="client", status=502)
        with patch.dict(os.environ, {"MANJEO_TRANSLATE_URL": ""}):
            self.assertEqual(self.request("POST", "/api/translate", {"text": "Bonjour", "from": "fr", "to": "fr"}, role="client")[0]["text"], "Bonjour")


class MessageWindowTests(unittest.TestCase):
    def test_terminal_event_controls_exact_grace_boundary_and_legacy_fallback(self):
        now = datetime(2026, 9, 12, 12, tzinfo=timezone.utc)
        with patch.object(messaging, "datetime") as clock:
            clock.now.return_value = now
            clock.fromisoformat.side_effect = datetime.fromisoformat
            for status in ("cancelled", "delivered"):
                for seconds, expected in ((1799.999, True), (1800, False), (1801, False), (-1, False)):
                    ended = (now - timedelta(seconds=seconds)).isoformat()
                    order = {"status": status, "updatedAt": now.isoformat(),
                             "history": [{"status": "accepted"}, {"status": status, "date": ended}]}
                    with self.subTest(status=status, age=seconds):
                        self.assertEqual(messaging.thread_open(order), expected)
                legacy = {"status": status, "updatedAt": now.isoformat(), "history": [{"status": "accepted"}]}
                self.assertTrue(messaging.thread_open(legacy))
                legacy["updatedAt"] = (now - timedelta(seconds=1800)).isoformat()
                self.assertFalse(messaging.thread_open(legacy))
                legacy["updatedAt"] = now.isoformat()
                legacy["history"].append({"status": status, "date": "invalid-date"})
                self.assertFalse(messaging.thread_open(legacy))


class MessagingTests(MessagingContracts, AppTestHarness):
    """Messaging checks with temporary SQLite databases."""


@unittest.skipUnless(os.environ.get("MANJEO_TEST_DATABASE_URL"), "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresMessagingTests(MessagingContracts, AppTestHarness):
    from server.test_postgres import PostgresIntegrationTests as _Harness
    setUp = _Harness.setUp
    tearDown = _Harness.tearDown
    close_server = _Harness.close_server
    drop_owned_schema = _Harness.drop_owned_schema


if __name__ == "__main__":
    unittest.main()
