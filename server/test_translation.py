"""Translation HTTP contracts; every provider request is mocked, never billed."""
import io
import http.client
import json
import os
import threading
import time
import unittest
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError
from unittest.mock import patch

from server import translation
from server.test_app import AppTestHarness


def provider_response(text="Mwen devan pòt la.", source="pt", finish="stop"):
    return io.BytesIO(json.dumps({"choices": [{"finish_reason": finish, "message": {
        "content": json.dumps({"from": source, "text": text})}}]}).encode())


class TranslationContracts:
    def setup_translation(self):
        env = patch.dict(os.environ, {"MANJEO_TRANSLATE_PROVIDER": "vercel", "MANJEO_TRANSLATE_MODEL": translation.DEFAULT_MODEL,
                                     "VERCEL_OIDC_TOKEN": "test-oidc-secret", "AI_GATEWAY_API_KEY": "", "MANJEO_TRANSLATE_URL": "",
                                     "MANJEO_TRANSLATE_REQUESTS_PER_MINUTE": "30", "MANJEO_TRANSLATE_CHARACTERS_PER_DAY": "20000",
                                     "MANJEO_TRANSLATE_REQUESTS_PER_DAY": "500"})
        env.start()
        self.addCleanup(env.stop)
        network_patch = patch.object(translation._gateway_opener, "open")
        self.network = network_patch.start()
        self.addCleanup(network_patch.stop)
        self.network.side_effect = lambda *args, **kwargs: provider_response()

    def message(self, text="Estou na porta.", phrase=None):
        order = self.create_order()
        self.login("restaurant")
        self.request("PATCH", "/api/orders/" + order["id"], {"status": "accepted"}, role="restaurant")
        payload = {"phraseId": phrase} if phrase else {"body": text}
        message = self.request("POST", "/api/orders/" + order["id"] + "/messages", payload, role="client", status=201)[0]["message"]
        return order, message

    def translate(self, order, message, role="restaurant", target="ht", status=200):
        payload = {"orderId": order["id"], "messageId": message["id"]}
        if target is not None:
            payload["to"] = target
        return self.request("POST", "/api/translate", payload, role=role, status=status)[0]

    def test_detects_real_source_even_when_profile_matches_target_and_caches(self):
        order, message = self.message()
        self.assertEqual(message["language"], "fr")
        self.network.side_effect = lambda *args, **kwargs: provider_response("Je suis devant la porte.", "pt")
        first = self.translate(order, message, target="fr")
        self.assertEqual(first, {"text": "Je suis devant la porte.", "from": "pt", "to": "fr", "cached": False, "provider": "vercel"})
        second = self.translate(order, message, role="client", target="fr")
        self.assertTrue(second["cached"])
        self.assertEqual(second["text"], first["text"])
        self.assertEqual(self.network.call_count, 1)
        request = self.network.call_args.args[0]
        self.assertEqual(request.full_url, translation.GATEWAY_URL)
        self.assertEqual(request.get_header("Authorization"), "Bearer test-oidc-secret")
        body = json.loads(request.data)
        self.assertEqual(body["model"], translation.DEFAULT_MODEL)
        self.assertTrue(body["providerOptions"]["gateway"]["disallowPromptTraining"])
        self.assertEqual(body["messages"][-1]["content"], message["body"])
        self.assertLessEqual(self.network.call_args.kwargs["timeout"], 8)
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT body FROM order_messages WHERE id = ?", (message["id"],)).fetchone()[0], message["body"])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM translation_usage").fetchone()[0], 1)

    def test_detected_same_language_preserves_original_without_rewriting(self):
        order, message = self.message("Bonjour !!!")
        self.network.side_effect = lambda *args, **kwargs: provider_response("Bonjour.", "fr")
        result = self.translate(order, message, target="fr")
        self.assertEqual(result["text"], "Bonjour !!!")
        self.assertEqual(self.network.call_count, 1)

    def test_defaults_to_viewer_profile_and_translates_known_phrases_without_provider(self):
        order, message = self.message(phrase="thanks")
        self.request("PATCH", "/api/profile", {"language": "pt"}, role="restaurant")
        with patch.dict(os.environ, {"VERCEL_OIDC_TOKEN": ""}):
            result = self.translate(order, message, target=None)
        self.assertEqual(result["to"], "pt")
        self.assertEqual(result["provider"], "phrases")
        self.assertIn("obrigado", result["text"])
        self.network.assert_not_called()

    def test_cache_rechecks_membership_after_courier_releases_assignment(self):
        order, message = self.message()
        self.login("courier")
        self.request("PATCH", "/api/courier/profile", {"online": True}, role="courier")
        self.request("POST", "/api/orders/" + order["id"] + "/claim", {}, role="courier")
        self.translate(order, message, role="courier")
        self.request("POST", "/api/orders/" + order["id"] + "/release", {"reason": "Autre mission"}, role="courier")
        self.translate(order, message, role="courier", status=403)
        self.assertEqual(self.network.call_count, 1)

    def test_rejects_foreign_messages_unauthenticated_calls_and_invalid_fields(self):
        order, message = self.message()
        other = self.create_order()
        self.translate(other, message, status=404)
        self.translate(order, message, role=None, status=401)
        self.translate(order, message, target="xx", status=400)
        self.add_test_user("outsider", "client")
        self.login("outsider")
        self.translate(order, message, role="outsider", status=403)
        self.request("POST", "/api/translate", {"orderId": order["id"], "messageId": message["id"], "text": "override"}, role="client", status=400)
        self.network.assert_not_called()

    def test_arbitrary_legacy_text_never_uses_gateway(self):
        self.login("client")
        self.request("POST", "/api/translate", {"text": "Bonjour", "from": "fr", "to": "pt"}, role="client", status=503)
        self.network.assert_not_called()

    def test_explicit_relay_detects_source_for_scoped_messages(self):
        order, message = self.message()
        with patch.dict(os.environ, {"MANJEO_TRANSLATE_PROVIDER": "libretranslate", "MANJEO_TRANSLATE_URL": "https://translation.example/translate"}):
            result = {"translatedText": "Mwen devan pòt la.", "detectedLanguage": {"language": "pt", "confidence": 95}}
            with patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps(result).encode())) as relay:
                translated = self.translate(order, message)
            self.assertEqual(translated["from"], "pt")
            self.assertEqual(translated["provider"], "libretranslate")
            self.assertEqual(json.loads(relay.call_args.args[0].data)["source"], "auto")
        self.network.assert_not_called()

    def test_activation_error_is_clear_private_and_retryable(self):
        order, message = self.message()
        failure = {"error": {"type": "customer_verification_required", "message": "private upstream diagnostic"}}
        self.network.side_effect = HTTPError(translation.GATEWAY_URL, 403, "Forbidden", {}, io.BytesIO(json.dumps(failure).encode()))
        result = self.translate(order, message, status=503)
        self.assertIn("activé", result["error"])
        self.assertNotIn("private", result["error"])
        self.assertNotIn("test-oidc-secret", result["error"])
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM translation_cache").fetchone()[0], 0)
        self.network.side_effect = lambda *args, **kwargs: provider_response()
        self.assertEqual(self.translate(order, message)["text"], "Mwen devan pòt la.")

    def test_empty_identical_incomplete_and_invalid_results_are_never_cached(self):
        order, message = self.message()
        for factory in (lambda: provider_response(""), lambda: provider_response(message["body"]),
                        lambda: provider_response(finish="length"), lambda: io.BytesIO(b"null"),
                        lambda: io.BytesIO(b"invalid"), lambda: io.BytesIO(b"x" * 40000),
                        lambda: io.BytesIO(b"[" * 1200 + b"0" + b"]" * 1200)):
            self.network.side_effect = lambda *args, factory=factory, **kwargs: factory()
            self.translate(order, message, status=502)
            with self.database.connect() as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM translation_cache").fetchone()[0], 0)
        self.network.side_effect = TimeoutError()
        self.translate(order, message, status=502)

    def test_interrupted_gateway_error_body_keeps_controlled_status_and_releases_reservation(self):
        order, message = self.message()
        class InterruptedBody(io.BytesIO):
            def read(self, *args):
                raise http.client.IncompleteRead(b"partial")
        for upstream_status, expected_status in ((403, 503), (429, 429), (500, 502)):
            with self.subTest(upstream_status=upstream_status):
                self.network.side_effect = HTTPError(translation.GATEWAY_URL, upstream_status, "Unavailable", {}, InterruptedBody())
                self.translate(order, message, status=expected_status)
                with self.database.connect() as db:
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM translation_cache").fetchone()[0], 0)

    def test_cache_survives_restart_and_is_invalidated_by_model_change(self):
        order, message = self.message()
        self.translate(order, message)
        self.database.initialize()
        self.assertTrue(self.translate(order, message)["cached"])
        with patch.dict(os.environ, {"MANJEO_TRANSLATE_MODEL": "openai/gpt-4.1-nano"}):
            self.assertFalse(self.translate(order, message)["cached"])
        self.assertEqual(self.network.call_count, 2)

    def test_quotas_persist_per_minute_and_project_day(self):
        order, message = self.message()
        stamp = int(time.time())
        with self.database.connect() as db:
            self.database.begin_write(db)
            for index in range(30):
                db.execute("INSERT INTO translation_usage VALUES (?, ?, ?, ?)", (str(index), "demo-restaurant", 1, stamp))
        self.translate(order, message, status=429)
        self.network.assert_not_called()
        with self.database.connect() as db:
            self.database.begin_write(db)
            db.execute("DELETE FROM translation_usage")
            db.execute("INSERT INTO translation_usage VALUES (?, ?, ?, ?)", ("project", "demo-client", 20_000, stamp))
        self.translate(order, message, status=429)
        self.network.assert_not_called()
        with patch("server.translation.now_epoch", return_value=stamp + 86401):
            self.assertEqual(self.translate(order, message)["provider"], "vercel")

    def test_external_request_holds_no_command_lock_and_duplicate_reservation_is_bounded(self):
        order, message = self.message()
        entered, release = threading.Event(), threading.Event()
        def delayed_provider(*args, **kwargs):
            entered.set()
            if not release.wait(4):
                raise TimeoutError()
            return provider_response()
        self.network.side_effect = delayed_provider
        with ThreadPoolExecutor(max_workers=1) as pool:
            running = pool.submit(self.translate, order, message)
            self.assertTrue(entered.wait(3))
            try:
                started = time.monotonic()
                self.translate(order, message, role="client", status=429)
                self.request("PATCH", "/api/profile", {"name": "Restaurant de test"}, role="restaurant")
                self.assertLess(time.monotonic() - started, 2)
            finally:
                release.set()
            self.assertEqual(running.result(timeout=4)["provider"], "vercel")
        self.assertEqual(self.network.call_count, 1)

    def test_cache_publication_rechecks_acl_after_network_request(self):
        order, message = self.message()
        self.login("courier")
        self.request("PATCH", "/api/courier/profile", {"online": True}, role="courier")
        self.request("POST", "/api/orders/" + order["id"] + "/claim", {}, role="courier")
        def release_during_request(*args, **kwargs):
            self.request("POST", "/api/orders/" + order["id"] + "/release", {"reason": "Autre mission"}, role="courier")
            return provider_response()
        self.network.side_effect = release_during_request
        self.translate(order, message, role="courier", status=403)
        with self.database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM translation_cache").fetchone()[0], 0)


class TranslationTests(TranslationContracts, AppTestHarness):
    def setUp(self):
        super().setUp()
        self.setup_translation()


class TranslationConfigurationTests(unittest.TestCase):
    def test_oidc_uses_fresh_trusted_runtime_header_and_explicit_key_takes_precedence(self):
        handler = SimpleNamespace(state=SimpleNamespace(config=SimpleNamespace(cloud=True)),
                                  headers={"x-vercel-oidc-token": "request-token"})
        with patch.dict(os.environ, {"VERCEL": "1", "VERCEL_OIDC_TOKEN": "environment-token"}, clear=True):
            self.assertEqual(translation.gateway_token(handler), "request-token")
            with patch.dict(os.environ, {"AI_GATEWAY_API_KEY": "explicit-key"}):
                self.assertEqual(translation.gateway_token(handler), "explicit-key")
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(translation.gateway_token(handler))
            with self.assertRaises(translation.APIError) as error:
                translation.provider_config(handler)
            self.assertEqual(error.exception.status, 503)

    def test_bad_models_and_redirects_are_refused(self):
        handler = SimpleNamespace(state=SimpleNamespace(config=SimpleNamespace(cloud=False)), headers={})
        with patch.dict(os.environ, {"MANJEO_TRANSLATE_PROVIDER": "vercel", "VERCEL_OIDC_TOKEN": "test-token",
                                     "MANJEO_TRANSLATE_MODEL": "https://other.example/model"}, clear=True):
            with self.assertRaises(translation.APIError):
                translation.provider_config(handler)
        self.assertIsNone(translation.NoRedirects().redirect_request(None, None, 307, "Redirect", {}, "https://other.example"))


@unittest.skipUnless(os.environ.get("MANJEO_TEST_DATABASE_URL"), "MANJEO_TEST_DATABASE_URL absent : PostgreSQL non testé")
class PostgresTranslationTests(TranslationContracts, AppTestHarness):
    from server.test_postgres import PostgresIntegrationTests as _Harness
    def setUp(self):
        self._Harness.setUp(self)
        self.setup_translation()
    tearDown = _Harness.tearDown
    close_server = _Harness.close_server
    drop_owned_schema = _Harness.drop_owned_schema


if __name__ == "__main__":
    unittest.main()
