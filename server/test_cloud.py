"""Cloud transport checks; all HTTP requests and data stay on this machine."""
import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from . import app
except ImportError:
    from server import app


class CloudConfigurationTests(unittest.TestCase):
    def test_vercel_without_durable_database_fails_closed(self):
        # Never let a serverless cold start quietly create an ephemeral database.
        for environment in ({"VERCEL": "1"}, {"VERCEL": "1", "MANJEO_DB": "/tmp/ephemeral.sqlite3"}):
            with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True):
                with patch.object(app, "Database") as local_database:
                    with self.assertRaises(app.APIError) as error:
                        app.create_database_from_environment()
                self.assertEqual(error.exception.status, 503)
                local_database.assert_not_called()

    def test_local_database_remains_an_explicit_local_option(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "isolated.sqlite3"
            with patch.dict(os.environ, {"MANJEO_DB": str(path)}, clear=True):
                database = app.create_database_from_environment()
            self.assertIsInstance(database, app.Database)
            self.assertEqual(Path(database.path), path)
            with database.connect() as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM users").fetchone()[0], 3)

    def test_explicit_cloud_state_also_requires_durable_database(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(app, "Database") as local_database:
            state = app.AppState(config=app.AppConfig(cloud=True))
            with self.assertRaises(app.APIError) as error:
                _ = state.database
        self.assertEqual(error.exception.status, 503)
        local_database.assert_not_called()


class CloudTransportTests(unittest.TestCase):
    HOST = "manjeo.example"
    PREVIEW_HOST = "preview-manjeo.vercel.app"

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = app.Database(Path(self.directory.name) / "isolated.sqlite3")
        static = Path(self.directory.name) / "dist"
        static.mkdir()
        (static / "index.html").write_text("<html>Cloud transport test</html>")
        config = app.AppConfig(cloud=True, app_origin="https://" + self.HOST,
                               allowed_hosts={self.HOST, self.PREVIEW_HOST})
        self.server = app.ManjeoServer(("127.0.0.1", 0), self.database, static, config=config)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, method="GET", path="/api/session", data=None, headers=None, status=200):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        request_headers = {"Host": self.HOST, "Origin": "https://" + self.HOST}
        if data is not None:
            request_headers["Content-Type"] = "application/json"
        request_headers.update(headers or {})
        connection.request(method, path, json.dumps(data) if data is not None else None, request_headers)
        response = connection.getresponse()
        body = response.read()
        self.assertEqual(response.status, status, body.decode())
        result = json.loads(body), dict(response.getheaders())
        connection.close()
        return result

    def test_https_login_and_logout_cookies_are_secure(self):
        body, headers = self.request("POST", "/api/login", {
            "email": "client@manjeo.test", "password": "ManjeoDemo2026!",
        })
        self.assertEqual(body["user"]["role"], "client")
        cookie = headers["Set-Cookie"]
        for directive in ("Secure", "HttpOnly", "SameSite=Strict", "Path=/"):
            self.assertIn(directive, cookie)
        session = cookie.split(";", 1)[0]
        body, _ = self.request(headers={"Cookie": session})
        self.assertEqual(body["user"]["email"], "client@manjeo.test")
        _, headers = self.request("POST", "/api/logout", {}, {"Cookie": session})
        self.assertIn("Secure", headers["Set-Cookie"])
        self.assertIn("Max-Age=0", headers["Set-Cookie"])
        self.assertIsNone(self.request(headers={"Cookie": session})[0]["user"])

    def test_explicit_preview_host_accepts_its_own_https_origin(self):
        self.assertEqual(self.request(headers={
            "Host": self.PREVIEW_HOST, "Origin": "https://" + self.PREVIEW_HOST,
        })[0], {"user": None})

    def test_vercel_dispatch_wrapper_and_rewritten_routes(self):
        from api.index import handler
        application_state = self.server.application

        class VercelWrappedHandler(handler):
            application = application_state

            def handle_request(self):
                # Vercel owns this method and dispatches to the HTTP verb.
                return getattr(super(), "do_" + self.command)()

            def do_GET(self):
                return self.handle_request()

            def do_POST(self):
                return self.handle_request()

        self.server.RequestHandlerClass = VercelWrappedHandler
        self.assertEqual(self.request(path="/api/index?route=session")[0], {"user": None})
        body, headers = self.request("POST", "/api/index?route=login", {
            "email": "client@manjeo.test", "password": "ManjeoDemo2026!",
        })
        self.assertEqual(body["user"]["role"], "client")
        self.assertIn("Secure", headers["Set-Cookie"])
        self.request(path="/api/index?route=session&route=users", status=400)

    def test_untrusted_hosts_and_origins_are_rejected(self):
        invalid = [
            {"Host": "attacker.example", "Origin": "https://attacker.example"},
            {"Host": "attacker.example", "X-Forwarded-Host": self.HOST},
            {"Host": self.HOST + ".attacker.example"},
            {"Host": self.HOST + "@attacker.example"},
            {"Origin": "https://attacker.example"},
            {"Origin": "http://" + self.HOST},
            {"Origin": "null"},
            {"Sec-Fetch-Site": "cross-site"},
        ]
        for headers in invalid:
            with self.subTest(headers=headers):
                self.request(headers=headers, status=403)

    def test_ip_login_limit_survives_email_rotation_and_instances(self):
        headers = {"x-vercel-forwarded-for": "203.0.113.10"}
        for index in range(30):
            self.request("POST", "/api/login", {
                "email": "unknown-%d@example.test" % index, "password": "wrong",
            }, headers=headers, status=401)
        self.request("POST", "/api/login", {
            "email": "client@manjeo.test", "password": "ManjeoDemo2026!",
        }, headers=headers)
        reloaded = app.Database(self.database.path)
        self.server.application = app.AppState(reloaded, self.server.application.config)
        for index in range(30, 60):
            self.request("POST", "/api/login", {
                "email": "unknown-%d@example.test" % index, "password": "wrong",
            }, headers=headers, status=401)
        self.request("POST", "/api/login", {
            "email": "another@example.test", "password": "wrong",
        }, headers=headers, status=429)
        # A blocked client IP must not lock every visitor out of the application.
        self.request("POST", "/api/login", {
            "email": "client@manjeo.test", "password": "ManjeoDemo2026!",
        }, headers={"x-vercel-forwarded-for": "203.0.113.11"})


if __name__ == "__main__":
    unittest.main()
