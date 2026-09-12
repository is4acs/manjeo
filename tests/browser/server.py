"""Disposable browser-test API. Never imports or connects to a deployment DB."""
import os
import secrets
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def main():
    # A test launched from a shell with production variables must stay isolated.
    for key in list(os.environ):
        if key.startswith(("MANJEO_", "STRIPE_", "VERCEL")) or key in {"DATABASE_URL", "POSTGRES_URL", "APP_ORIGIN", "AI_GATEWAY_API_KEY"}:
            os.environ.pop(key, None)
    from server.app import AppConfig, Database, ManjeoServer, password_digest
    from server import customer

    def test_geocode(address, city):
        # Only the external geocoder is replaced. Token ownership, profile saves,
        # prices, commands, assignments and PIN validation use the real API.
        candidates = []
        if address.casefold() == "7 rue lallouette" and city == "Cayenne":
            candidates.append({"address": "7 Rue Lallouette", "city": city,
                               "latitude": 4.939915, "longitude": -52.332754,
                               "provider": "ign", "precision": "house"})
        return {"candidates": candidates, "source": "ign"}

    customer.geocode = test_geocode
    with TemporaryDirectory(prefix="manjeo-browser-") as directory:
        database = Database(Path(directory) / "test.sqlite3")
        with database.connect() as connection:
            salt = secrets.token_hex(16)
            connection.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
                               ("browser-other-client", "client-other@manjeo.test", "Client B", "client", None,
                                salt, password_digest("ManjeoDemo2026!", salt)))
        server = ManjeoServer(("127.0.0.1", 0), database, config=AppConfig(cloud=False))
        print("MANJEO_BROWSER_TEST_URL=http://127.0.0.1:%d" % server.server_port, flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()


if __name__ == "__main__":
    main()
