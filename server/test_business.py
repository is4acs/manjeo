"""Règles métier partagées : expiration, codes promo, estimation et saisie d'adresse."""
import json
import unittest

from server.test_app import AppTestHarness


class BusinessRuleTests(AppTestHarness):
    def expire(self, order_id):
        """Ramène l'échéance d'acceptation dans le passé, comme le ferait l'attente réelle."""
        with self.database.connect() as db:
            order = json.loads(db.execute("SELECT data FROM orders WHERE id = ?", (order_id,)).fetchone()["data"])
            order["acceptBy"] = "2000-01-01T00:00:00.000Z"
            db.execute("UPDATE orders SET data = ? WHERE id = ?", (json.dumps(order, ensure_ascii=False), order_id))

    def promo_payload(self, code, discount, restaurant="ti-kreol", product="kreol-poulet"):
        payload = self.order_payload(restaurant, product)
        payload["promoCode"] = code
        payload["expectedTotal"] -= discount
        return payload

    def test_unanswered_order_cancels_itself_after_the_deadline(self):
        order = self.create_order()
        self.assertGreater(order["acceptBy"], order["date"])
        self.assertIsNone(order["eta"])
        self.expire(order["id"])
        orders = self.request("GET", "/api/orders", role="client")[0]["orders"]
        expired = next(row for row in orders if row["id"] == order["id"])
        self.assertEqual(expired["status"], "cancelled")
        self.assertIn("dix minutes", expired["history"][-1]["label"])
        self.assertNotIn("actorName", expired["history"][-1])
        self.login("restaurant")
        # La commande expirée ne peut plus être acceptée, et elle quitte les offres livreur.
        self.request("PATCH", "/api/orders/%s" % order["id"], {"status": "accepted"}, role="restaurant", status=409)
        with self.database.connect() as db:
            state = db.execute("SELECT state FROM order_assignments WHERE order_id = ?", (order["id"],)).fetchone()["state"]
        self.assertEqual(state, "cancelled")

    def test_expiry_runs_inside_an_ongoing_write(self):
        """Une écriture ouvre déjà sa transaction : l'expiration ne doit pas en rouvrir une."""
        first = self.create_order()
        self.expire(first["id"])
        second = self.create_order()
        self.assertEqual(second["status"], "pending")
        orders = self.request("GET", "/api/orders", role="client")[0]["orders"]
        self.assertEqual(next(row for row in orders if row["id"] == first["id"])["status"], "cancelled")

    def test_acceptance_sets_the_estimate_and_clears_the_deadline(self):
        order = self.create_order()
        self.login("restaurant")
        accepted = self.request("PATCH", "/api/orders/%s" % order["id"], {"status": "accepted"}, role="restaurant")[0]["order"]
        self.assertIsNone(accepted["acceptBy"])
        self.assertGreater(accepted["eta"], accepted["updatedAt"])
        self.expire(order["id"])
        orders = self.request("GET", "/api/orders", role="restaurant")[0]["orders"]
        self.assertEqual(next(row for row in orders if row["id"] == order["id"])["status"], "accepted")

    def test_client_cannot_pile_up_more_than_five_running_orders(self):
        for _ in range(5):
            self.create_order()
        self.request("POST", "/api/orders", self.order_payload(), role="client", status=409)
        # Une commande terminée libère la place.
        orders = self.request("GET", "/api/orders", role="client")[0]["orders"]
        self.request("PATCH", "/api/orders/%s" % orders[0]["id"],
                     {"status": "cancelled", "reason": "Je change d’avis"}, role="client")
        self.create_order()

    def test_promotion_is_recomputed_by_the_server(self):
        self.login("client")
        restaurant, _ = self.catalog_product("kreol-poulet")
        item = self.item_payload()
        subtotal = item["unitPrice"] * item["quantity"]
        preview = self.request("POST", "/api/promotions/check",
                               {"code": "bienvenue", "restaurantId": "ti-kreol", "city": "Cayenne", "subtotal": subtotal},
                               role="client")[0]["promotion"]
        self.assertEqual(preview["code"], "BIENVENUE")
        self.assertEqual(preview["discount"], subtotal * 20 // 100)
        # Un total qui ignore la remise annoncée est refusé.
        wrong = self.order_payload()
        wrong["promoCode"] = "BIENVENUE"
        self.request("POST", "/api/orders", wrong, role="client", status=409)
        order = self.create_order(self.promo_payload("BIENVENUE", preview["discount"]))
        self.assertEqual(order["promoCode"], "BIENVENUE")
        self.assertEqual(order["discount"], preview["discount"])
        self.assertEqual(order["total"], order["subtotal"] + order["delivery"] - order["discount"])

    def test_promotion_rules_are_enforced(self):
        self.login("client")
        item = self.item_payload()
        subtotal = item["unitPrice"] * item["quantity"]
        for code, status in (("INCONNU", 404), ("TIKAZ5", 409)):
            # TIKAZ5 est réservé à Ti Kaz Kréol : il ne s'applique pas ailleurs.
            self.request("POST", "/api/promotions/check",
                         {"code": code, "restaurantId": "smash-club", "city": "Cayenne", "subtotal": subtotal},
                         role="client", status=status)
        self.request("POST", "/api/promotions/check",
                     {"code": "LIVRAISON", "restaurantId": "ti-kreol", "city": "Cayenne", "subtotal": 1000},
                     role="client", status=409)
        offered = self.request("GET", "/api/promotions")[0]["promotions"]
        self.assertEqual({row["code"] for row in offered}, {"BIENVENUE", "LIVRAISON", "TIKAZ5"})

    def test_a_code_is_consumed_once_and_released_by_a_cancellation(self):
        self.login("client")
        item = self.item_payload()
        discount = item["unitPrice"] * item["quantity"] * 20 // 100
        order = self.create_order(self.promo_payload("BIENVENUE", discount))
        self.request("POST", "/api/orders", self.promo_payload("BIENVENUE", discount), role="client", status=409)
        self.request("PATCH", "/api/orders/%s" % order["id"],
                     {"status": "cancelled", "reason": "Erreur de commande"}, role="client")
        reused = self.create_order(self.promo_payload("BIENVENUE", discount))
        self.assertEqual(reused["discount"], discount)

    def test_free_delivery_code_only_covers_the_delivery_fee(self):
        self.login("client")
        payload = self.order_payload()
        restaurant, _ = self.catalog_product("kreol-poulet")
        # Le code exige 25 € de panier : trois parts le franchissent.
        payload["items"] = [self.item_payload(quantity=3)]
        payload["expectedTotal"] = payload["items"][0]["unitPrice"] * 3 + restaurant["delivery"]
        payload["promoCode"] = "LIVRAISON"
        payload["expectedTotal"] -= restaurant["delivery"]
        order = self.create_order(payload)
        self.assertEqual(order["discount"], order["delivery"])
        self.assertEqual(order["total"], order["subtotal"])

    def test_address_directory_completes_a_street(self):
        suggestions = self.request("GET", "/api/addresses?q=7%20rue&city=Cayenne")[0]["addresses"]
        self.assertTrue(suggestions)
        self.assertTrue(all(row["label"].startswith("7 Rue") for row in suggestions))
        self.assertTrue(all(row["city"] == "Cayenne" for row in suggestions))
        self.assertEqual(self.request("GET", "/api/addresses?q=%20")[0]["addresses"], [])
        self.assertEqual(self.request("GET", "/api/addresses?q=zzzz")[0]["addresses"], [])


if __name__ == "__main__":
    unittest.main()
