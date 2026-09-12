"""IGN adapter contracts; every external response is mocked, never networked."""
import io
import json
import unittest
from http.client import IncompleteRead
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

from server import addresses


def feature(code="97302", name="7 Rue Lallouette", **properties):
    return {"type": "Feature", "properties": {"name": name, "housenumber": "7", "street": "Rue Lallouette",
                                               "citycode": code, "city": "Cayenne", **properties}}


class Response(io.BytesIO):
    def __init__(self, body, content_type="application/json", status=200):
        super().__init__(body if isinstance(body, bytes) else json.dumps(body).encode())
        self.status = status
        self.headers = {"Content-Type": content_type}


class AddressLookupTests(unittest.TestCase):
    def setUp(self):
        with addresses._cache_lock:
            addresses._cache.clear()
        self.network = patch("server.addresses._opener.open")
        self.open = self.network.start()
        self.addCleanup(self.network.stop)
        self.open.side_effect = lambda *args, **kwargs: Response({"type": "FeatureCollection", "features": [feature()]})

    def test_offline_lookup_keeps_deterministic_suggestions_and_never_calls_network(self):
        result = addresses.lookup("7 rue lall", "Cayenne", remote=False)
        self.assertEqual(result["source"], "demo")
        self.assertEqual(result["addresses"], addresses.suggest("7 rue lall", "Cayenne"))
        self.open.assert_not_called()

    def test_request_uses_only_fixed_ign_url_and_bounded_timeout(self):
        query = "7 rue & citycode=75056 https://example.org/"
        result = addresses.lookup(query, "Cayenne")
        request = self.open.call_args.args[0]
        target = urlsplit(request.full_url)
        self.assertEqual((target.scheme, target.netloc, target.path), ("https", "data.geopf.fr", "/geocodage/search"))
        parameters = parse_qs(target.query)
        self.assertEqual(parameters["q"], [query])
        self.assertEqual(parameters["citycode"], ["97302"])
        self.assertEqual(parameters["index"], ["address"])
        self.assertEqual(parameters["limit"], ["6"])
        self.assertEqual(self.open.call_args.kwargs["timeout"], 2.5)
        self.assertEqual(result, {"addresses": [{"label": "7 Rue Lallouette", "number": "7", "street": "Rue Lallouette", "city": "Cayenne"}], "source": "ign"})

    def test_provider_fields_are_typed_filtered_deduplicated_and_canonicalized(self):
        malformed = [None, {"properties": []}, feature(code="75056"), feature(code="97309"),
                     feature(name=123), feature(housenumber=[]), feature(street=None), feature(name="Rue\x00interdite")]
        self.open.side_effect = lambda *args, **kwargs: Response({"type": "FeatureCollection", "features": malformed + [feature(city="Nom non fiable"), feature()]})
        result = addresses.lookup("7 rue", "Cayenne")
        self.assertEqual(len(result["addresses"]), 1)
        self.assertEqual(result["addresses"][0]["city"], "Cayenne")
        self.assertEqual(set(result["addresses"][0]), {"label", "number", "street", "city"})

    def test_successful_empty_ign_response_is_not_replaced_by_demo_addresses(self):
        self.open.side_effect = lambda *args, **kwargs: Response({"type": "FeatureCollection", "features": []})
        self.assertEqual(addresses.lookup("7 rue", "Cayenne"), {"addresses": [], "source": "ign"})

    def test_outages_fall_back_explicitly_and_leave_manual_entry_possible(self):
        failures = [TimeoutError(), URLError("Unavailable"), OSError("Disconnected"),
                    HTTPError(addresses.IGN_URL, 503, "Unavailable", {}, None), IncompleteRead(b"{}")]
        for index, failure in enumerate(failures):
            with self.subTest(error=type(failure).__name__):
                self.open.side_effect = failure
                result = addresses.lookup("%s rue" % (index + 1), "Cayenne")
                self.assertEqual(result["source"], "demo")
                self.assertTrue(result["addresses"])
                self.assertIn("librement", result["note"])
                self.assertTrue(all(row["city"] == "Cayenne" for row in result["addresses"]))

    def test_invalid_or_oversized_payload_falls_back_without_server_error(self):
        factories = [lambda: Response(b"not json"), lambda: Response({"features": None}),
                     lambda: Response(b"x" * (addresses.MAX_RESPONSE_BYTES + 10)),
                     lambda: Response(b"<html>error</html>", "text/html")]
        for index, factory in enumerate(factories):
            with self.subTest(index=index):
                self.open.side_effect = lambda *args, **kwargs: factory()
                self.assertEqual(addresses.lookup("%s rue" % (index + 1), "Cayenne")["source"], "demo")

    def test_cache_is_short_lived_bounded_and_not_mutable_by_callers(self):
        with patch("server.addresses.time.monotonic", return_value=100):
            first = addresses.lookup("7 rue", "Cayenne")
            first["addresses"][0]["label"] = "Changed by caller"
            second = addresses.lookup("7 rue", "Cayenne")
        self.assertEqual(second["addresses"][0]["label"], "7 Rue Lallouette")
        self.assertEqual(self.open.call_count, 1)
        with patch("server.addresses.time.monotonic", return_value=100 + addresses.CACHE_TTL_SECONDS):
            addresses.lookup("7 rue", "Cayenne")
        self.assertEqual(self.open.call_count, 2)
        with patch("server.addresses.MAX_CACHE_ENTRIES", 3):
            for number in range(10, 16):
                addresses.lookup("%s rue" % number, "Cayenne")
            self.assertEqual(len(addresses._cache), 3)

    def test_failure_cache_expires_quickly_to_allow_recovery(self):
        self.open.side_effect = TimeoutError()
        with patch("server.addresses.time.monotonic", return_value=100):
            self.assertEqual(addresses.lookup("7 rue", "Cayenne")["source"], "demo")
            self.assertEqual(addresses.lookup("7 rue", "Cayenne")["source"], "demo")
        self.assertEqual(self.open.call_count, 1)
        self.open.side_effect = lambda *args, **kwargs: Response({"type": "FeatureCollection", "features": [feature()]})
        with patch("server.addresses.time.monotonic", return_value=100 + addresses.FAILURE_CACHE_TTL_SECONDS):
            self.assertEqual(addresses.lookup("7 rue", "Cayenne")["source"], "ign")
        self.assertEqual(self.open.call_count, 2)

    def test_no_commune_search_is_restricted_to_the_three_supported_codes(self):
        def respond(request, **kwargs):
            code = parse_qs(urlsplit(request.full_url).query)["citycode"][0]
            return Response({"type": "FeatureCollection", "features": [feature(code=code)]})
        self.open.side_effect = respond
        result = addresses.lookup("7 rue", None)
        self.assertEqual({row["city"] for row in result["addresses"]}, set(addresses.CITY_CODES))
        self.assertEqual(self.open.call_count, 3)

    def test_empty_short_invalid_queries_never_call_provider(self):
        for query, city in ((None, "Cayenne"), ("", "Cayenne"), ("  ", "Cayenne"),
                            ("7", "Cayenne"), ("7 rue", "Kourou"), ("7 rue", ["Cayenne"])):
            self.assertEqual(addresses.lookup(query, city)["addresses"], [])
        self.open.assert_not_called()

    def test_redirects_cannot_change_the_configured_destination(self):
        handler = addresses._NoRedirects()
        self.assertIsNone(handler.redirect_request(None, None, 302, "Found", {}, "https://other.example/"))

    def test_suggestions_are_limited_to_six_and_street_only_results_are_supported(self):
        rows = [feature(name="Rue %s" % number, housenumber="", street="Rue %s" % number) for number in range(12)]
        self.open.side_effect = lambda *args, **kwargs: Response({"type": "FeatureCollection", "features": rows}, "application/geo+json")
        result = addresses.lookup("rue", "Cayenne")
        self.assertEqual(len(result["addresses"]), 6)
        self.assertTrue(all(row["number"] == "" for row in result["addresses"]))


if __name__ == "__main__":
    unittest.main()
