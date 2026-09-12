"""Profils, ouverture des coordonnées et messagerie de commande."""
import unittest

from server.test_app import AppTestHarness


class MessagingTests(AppTestHarness):
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
        self.assertEqual(client_card["phone"], "0694 00 00 01")
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
        self.request("POST", "/api/translate", {"text": "Bom dia", "from": "pt", "to": "ht"}, role="client", status=503)
        self.request("POST", "/api/translate", {"text": "Bom dia", "from": "pt", "to": "xx"}, role="client", status=400)


if __name__ == "__main__":
    unittest.main()
