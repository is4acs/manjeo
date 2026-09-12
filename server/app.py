"""Manjéo demo API: SQLite locally, PostgreSQL behind Vercel Functions."""
import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
# Python ne connaît pas ce type ; sans lui le manifeste part en octet-stream et nosniff le rejette.
mimetypes.add_type("application/manifest+json", ".webmanifest")
COOKIE_NAME = "manjeo_session"
SESSION_SECONDS = 8 * 60 * 60
PASSWORD_ITERATIONS = 240_000
CITIES = {"Cayenne", "Rémire-Montjoly", "Matoury"}
TRANSITIONS = {
    "pending": {"accepted", "cancelled"},
    "accepted": {"preparing", "cancelled"},
    "preparing": {"ready", "cancelled"},
    "ready": {"picked_up", "cancelled"},
    "picked_up": {"delivered"},
    "delivered": set(),
    "cancelled": set(),
}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def password_digest(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PASSWORD_ITERATIONS).hex()


def public_user(row):
    return {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"], "restaurantId": row["restaurant_id"]}


class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


class AppConfig:
    """Explicit deployment boundaries; forwarded headers never authorize a host."""

    def __init__(self, cloud=None, app_origin=None, allowed_hosts=None):
        self.cloud = os.environ.get("VERCEL") == "1" if cloud is None else cloud
        self.secure_cookie = bool(self.cloud)
        self.allowed_hosts = set()
        if self.cloud:
            origin = app_origin or os.environ.get("APP_ORIGIN", "https://manjeo.vercel.app")
            parsed = urlsplit(origin)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
                raise APIError(503, "L’origine HTTPS de l’application est mal configurée.")
            self.allowed_hosts.add(parsed.netloc.lower())
            for variable in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
                value = os.environ.get(variable, "").strip().lower()
                if value:
                    self.allowed_hosts.add(value)
            if allowed_hosts:
                self.allowed_hosts.update(host.lower() for host in allowed_hosts)
            for host in self.allowed_hosts:
                # A strict hostname, optionally with an explicit HTTPS port; no wildcards.
                if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?", host):
                    raise APIError(503, "Un domaine autorisé de l’application est mal configuré.")


def create_database_from_environment(cloud=None):
    cloud = os.environ.get("VERCEL") == "1" if cloud is None else cloud
    dsn = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if dsn:
        try:
            from .postgres import PostgresDatabase
        except ImportError:
            raise APIError(503, "Le connecteur de la base de données est indisponible.") from None
        return PostgresDatabase(dsn)
    if cloud:
        raise APIError(503, "La base de données en ligne n’est pas encore configurée.")
    return Database(os.environ.get("MANJEO_DB", str(ROOT / ".data/manjeo.sqlite3")))


class AppState:
    def __init__(self, database=None, config=None):
        self._database = database
        self.config = config or AppConfig()
        self._database_lock = threading.Lock()

    @property
    def database(self):
        if self._database is None:
            with self._database_lock:
                if self._database is None:
                    # A failed initialization is not cached, allowing recovery after a transient outage.
                    self._database = create_database_from_environment(cloud=self.config.cloud)
        return self._database


def text_field(data, field, minimum=0, maximum=500):
    value = data.get(field, "")
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise APIError(400, "Le champ « %s » est invalide." % field)
    return value.strip()


class Database:
    row_order = "sort_order"

    def __init__(self, path, catalog_path=None):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.catalog_path = Path(catalog_path or ROOT / "lib/catalog.json")
        self.initialize()

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        with self.connect() as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS restaurants (
                    id TEXT PRIMARY KEY, data TEXT NOT NULL,
                    accepting_orders INTEGER NOT NULL DEFAULT 1 CHECK (accepting_orders IN (0,1)),
                    sort_order INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS products (
                    id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
                    data TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
                    sort_order INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('client','restaurant','admin','courier')),
                    restaurant_id TEXT REFERENCES restaurants(id),
                    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    expires_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS orders (
                    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id),
                    restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
                    request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL, data TEXT NOT NULL,
                    UNIQUE(customer_id, request_id)
                );
                CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id, created_at);
                CREATE INDEX IF NOT EXISTS orders_restaurant ON orders(restaurant_id, created_at);
                CREATE TABLE IF NOT EXISTS login_attempts (
                    key_hash TEXT NOT NULL, attempted_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts(key_hash, attempted_at);
            """)
            # SQLite cannot alter a CHECK constraint. Rebuild only users while
            # foreign keys are temporarily disabled, keeping every ID and row.
            users_sql = db.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").fetchone()[0]
            needs_roles_migration = "'courier'" not in users_sql
            if needs_roles_migration:
                db.execute("PRAGMA foreign_keys = OFF")
            # Preserve existing local databases from the first MVP.
            for table in ("restaurants", "products"):
                if "sort_order" not in {row["name"] for row in db.execute("PRAGMA table_info(" + table + ")")}:
                    db.execute("ALTER TABLE " + table + " ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            self.begin_write(db)
            if needs_roles_migration:
                db.execute("""CREATE TABLE users_v2 (
                    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('client','restaurant','admin','courier')),
                    restaurant_id TEXT REFERENCES restaurants(id),
                    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL
                )""")
                db.execute("INSERT INTO users_v2 SELECT * FROM users")
                db.execute("DROP TABLE users")
                db.execute("ALTER TABLE users_v2 RENAME TO users")
            self.seed(db)
            self.initialize_marketplace(db)
            if db.execute("PRAGMA foreign_key_check").fetchone():
                raise RuntimeError("Database migration failed its foreign key check")

    def begin_write(self, db):
        db.execute("BEGIN IMMEDIATE")

    def seed(self, db):
        for position, source in enumerate(json.loads(self.catalog_path.read_text())):
            restaurant = {key: value for key, value in source.items() if key not in ("products", "acceptingOrders")}
            if db.execute("SELECT id FROM restaurants WHERE id = ?", (restaurant["id"],)).fetchone():
                continue
            db.execute("INSERT INTO restaurants(id, data, sort_order) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING", (restaurant["id"], json.dumps(restaurant, ensure_ascii=False), position))
            for product_position, item in enumerate(source["products"]):
                product = {key: value for key, value in item.items() if key != "available"}
                db.execute("INSERT INTO products(id, restaurant_id, data, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING", (product["id"], restaurant["id"], json.dumps(product, ensure_ascii=False), product_position))
        for user_id, email, name, role, restaurant_id in [
            ("demo-client", "client@manjeo.test", "Camille Test", "client", None),
            ("demo-restaurant", "restaurant@manjeo.test", "Ti Kaz Kréol", "restaurant", "ti-kreol"),
            ("demo-admin", "admin@manjeo.test", "Admin Manjéo", "admin", None),
            ("demo-courier", "livreur@manjeo.test", "Alex Livraison", "courier", None),
        ]:
            if db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
                continue
            salt = secrets.token_hex(16)
            db.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING", (user_id, email, name, role, restaurant_id, salt, password_digest("ManjeoDemo2026!", salt)))
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
        db.execute("DELETE FROM login_attempts WHERE attempted_at <= ?", (int(time.time()) - 300,))

    def initialize_marketplace(self, db):
        from .marketplace import initialize_marketplace
        initialize_marketplace(db)

    @staticmethod
    def product(row):
        return {**json.loads(row["data"]), "available": bool(row["available"])}

    def restaurant(self, db, row):
        products = [self.product(item) for item in db.execute("SELECT * FROM products WHERE restaurant_id = ? ORDER BY sort_order, id", (row["id"],))]
        products = [product for product in products if not product.get("archived", False)]
        result = {
            **json.loads(row["data"]),
            "acceptingOrders": bool(row["accepting_orders"]),
            "products": products,
        }
        available = [product["price"] for product in products if product["available"]]
        result["from"] = min(available) if available else 0
        return result


class ManjeoServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, database, static_dir=None, config=None):
        self.database = database
        self.application = AppState(database, config)
        self.static_dir = Path(static_dir or ROOT / "dist").resolve()
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "Manjeo/1.0"

    @property
    def state(self):
        application = getattr(self, "application", None)
        return application if application is not None else self.server.application

    def log_message(self, format, *args):
        # The URL contains no credentials or customer details.
        super().log_message(format, *args)

    def json_response(self, status, payload, cookie=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise APIError(415, "Une requête JSON est requise.")
        if self.headers.get("Transfer-Encoding"):
            raise APIError(400, "Format de requête non pris en charge.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise APIError(400, "Requête invalide.")
        path = urlsplit(self.path).path
        limit = 1_500_000 if re.fullmatch(r"/api/restaurants/[A-Za-z0-9-]+/(?:images|menu)", path) else 64_000
        if not 0 < length <= limit:
            raise APIError(413 if length > limit else 400, "Taille de requête invalide.")
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise APIError(400, "Le JSON est invalide.")
        if not isinstance(data, dict):
            raise APIError(400, "Un objet JSON est requis.")
        return data

    def check_origin(self):
        host = self.headers.get("Host", "")
        if not host or any(char in host for char in ("/", "@", "\\", ",", " ", "\t", "\r", "\n")):
            raise APIError(403, "Domaine de la requête refusé.")
        try:
            hostname = urlsplit("http://" + host).hostname
        except ValueError:
            hostname = None
        config = self.state.config
        if config.cloud:
            if host.lower() not in config.allowed_hosts:
                raise APIError(403, "Domaine de la requête refusé.")
            scheme = "https"
        else:
            if hostname not in ("127.0.0.1", "localhost", "::1"):
                raise APIError(403, "Cette démonstration est accessible en local uniquement.")
            scheme = "http"
        origin = self.headers.get("Origin")
        if origin and origin != scheme + "://" + host:
            raise APIError(403, "Origine de la requête refusée.")
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            raise APIError(403, "Origine de la requête refusée.")

    def session_cookie(self, token="", max_age=0):
        result = "%s=%s; HttpOnly; SameSite=Strict; Path=/; Max-Age=%s" % (COOKIE_NAME, token, max_age)
        return result + ("; Secure" if self.state.config.secure_cookie else "")

    def login_address(self):
        address = self.client_address[0]
        if self.state.config.cloud:
            # Vercel overwrites this value at the trusted edge. Ignore it in local mode.
            address = self.headers.get("x-vercel-forwarded-for", address).split(",", 1)[0].strip()
        return address

    def login_key(self, email):
        return hashlib.sha256((self.login_address() + "|" + email).encode()).hexdigest()

    def login_ip_key(self):
        return hashlib.sha256(("ip|" + self.login_address()).encode()).hexdigest()

    def session_hash(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        item = cookie.get(COOKIE_NAME)
        return hashlib.sha256(item.value.encode()).hexdigest() if item else None

    def user(self, db, roles=None):
        user = db.execute("SELECT users.* FROM users JOIN sessions ON sessions.user_id = users.id WHERE sessions.token_hash = ? AND sessions.expires_at > ?", (self.session_hash(), int(time.time()))).fetchone()
        if not user:
            if roles is not None:
                raise APIError(401, "Connectez-vous pour continuer.")
            return None
        if roles is not None and user["role"] not in roles:
            raise APIError(403, "Votre compte ne permet pas cette action.")
        return user

    def managed_restaurant(self, db, restaurant_id):
        user = self.user(db, {"restaurant", "admin"})
        if user["role"] == "restaurant" and user["restaurant_id"] != restaurant_id:
            raise APIError(403, "Vous ne pouvez gérer que votre restaurant.")
        row = db.execute("SELECT * FROM restaurants WHERE id = ?", (restaurant_id,)).fetchone()
        if not row:
            raise APIError(404, "Restaurant introuvable.")
        return row

    def do_GET(self):
        self.dispatch_api()

    def do_POST(self):
        self.dispatch_api()

    def do_PATCH(self):
        self.dispatch_api()

    def do_OPTIONS(self):
        self.json_response(403, {"error": "Les requêtes depuis une autre origine sont refusées."})

    def dispatch_api(self):
        try:
            self.check_origin()
            path = urlsplit(self.path).path
            if not path.startswith("/api/"):
                if self.command != "GET":
                    raise APIError(405, "Méthode non autorisée.")
                return self.serve_static(path)
            data = self.read_json() if self.command in {"POST", "PATCH"} else None
            database = self.state.database
            self.in_write = False
            with database.connect() as db:
                if data is not None:
                    self.ensure_write(db)
                match = re.fullmatch(r"/api/images/([a-f0-9]{32})", path)
                if self.command == "GET" and match:
                    row = db.execute("SELECT content_type, content_base64 FROM menu_images WHERE id = ?", (match[1],)).fetchone()
                    if not row:
                        raise APIError(404, "Image introuvable.")
                    import base64
                    body = base64.b64decode(row["content_base64"])
                    self.send_response(200)
                    self.send_header("Content-Type", row["content_type"])
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
                    self.end_headers()
                    self.wfile.write(body)
                    return
                status, response, cookie = self.api(db, path, data)
            self.json_response(status, response, cookie)
        except APIError as error:
            self.json_response(error.status, {"error": error.message})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            import traceback
            traceback.print_exc()
            self.json_response(500, {"error": "Le serveur a rencontré une erreur. Réessayez."})

    def ensure_write(self, db):
        """Ouvre la transaction d’écriture une seule fois, même si une lecture la déclenche."""
        if not getattr(self, "in_write", False):
            self.state.database.begin_write(db)
            self.in_write = True

    def api(self, db, path, data):
        from .marketplace import expire_pending_orders, handle_marketplace, projected_order
        from .messaging import handle_messaging
        if path.startswith("/api/orders") or path in {"/api/deliveries", "/api/couriers"}:
            expire_pending_orders(self, db)
        response = handle_messaging(self, db, path, data)
        if response is not None:
            return response
        response = handle_marketplace(self, db, path, data)
        if response is not None:
            return response
        method = self.command
        if method == "GET" and path == "/api/session":
            from .messaging import profile
            user = self.user(db)
            return 200, {"user": {**public_user(user), **profile(db, user["id"])} if user else None}, None
        if method == "POST" and path == "/api/login":
            email = text_field(data, "email", 3, 254).lower()
            password = text_field(data, "password", 1, 200)
            key = self.login_key(email)
            ip_key = self.login_ip_key()
            stamp = int(time.time())
            db.execute("DELETE FROM login_attempts WHERE attempted_at <= ?", (stamp - 300,))
            failures = db.execute("SELECT COUNT(*) FROM login_attempts WHERE key_hash = ?", (key,)).fetchone()[0]
            ip_failures = db.execute("SELECT COUNT(*) FROM login_attempts WHERE key_hash = ?", (ip_key,)).fetchone()[0]
            if failures >= 20 or ip_failures >= 60:
                return 429, {"error": "Trop de tentatives. Réessayez dans cinq minutes."}, None
            row = db.execute("SELECT * FROM users WHERE lower(email) = ?", (email,)).fetchone()
            # An unknown email still incurs the password hashing cost.
            salt = row["password_salt"] if row else "00" * 16
            digest = password_digest(password, salt)
            if not row or not hmac.compare_digest(digest, row["password_hash"]):
                db.execute("INSERT INTO login_attempts(key_hash, attempted_at) VALUES (?, ?)", (key, stamp))
                db.execute("INSERT INTO login_attempts(key_hash, attempted_at) VALUES (?, ?)", (ip_key, stamp))
                # Return the error normally so the failure survives the transaction commit.
                return 401, {"error": "Adresse e-mail ou mot de passe incorrect."}, None
            # A successful login clears this account's failures, not the IP budget;
            # switching between accounts cannot reset the cross-account throttle.
            db.execute("DELETE FROM login_attempts WHERE key_hash = ?", (key,))
            token = secrets.token_urlsafe(32)
            db.execute("DELETE FROM sessions WHERE token_hash = ? OR expires_at <= ?", (self.session_hash(), int(time.time())))
            db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (hashlib.sha256(token.encode()).hexdigest(), row["id"], int(time.time()) + SESSION_SECONDS))
            from .messaging import profile
            return 200, {"user": {**public_user(row), **profile(db, row["id"])}}, self.session_cookie(token, SESSION_SECONDS)
        if method == "POST" and path == "/api/logout":
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (self.session_hash(),))
            return 200, {"ok": True}, self.session_cookie()
        if method == "GET" and path == "/api/addresses":
            from .addresses import suggest
            query = parse_qs(urlsplit(self.path).query)
            return 200, {"addresses": suggest((query.get("q") or [""])[0], (query.get("city") or [None])[0])}, None
        if method == "GET" and path == "/api/restaurants":
            rows = db.execute("SELECT * FROM restaurants ORDER BY sort_order, id").fetchall()
            return 200, {"restaurants": [self.state.database.restaurant(db, row) for row in rows]}, None
        if method == "GET" and path == "/api/users":
            self.user(db, {"admin"})
            from .messaging import profile
            return 200, {"users": [{**public_user(row), **profile(db, row["id"])} for row in db.execute("SELECT * FROM users ORDER BY id")]}, None
        if method == "GET" and path == "/api/orders":
            user = self.user(db, {"client", "restaurant", "courier", "admin"})
            clause, args = (" WHERE customer_id = ?", (user["id"],)) if user["role"] == "client" else ((" WHERE restaurant_id = ?", (user["restaurant_id"],)) if user["role"] == "restaurant" else ("", ()))
            if user["role"] == "courier":
                clause, args = " WHERE id IN (SELECT order_id FROM order_assignments WHERE courier_id = ?)", (user["id"],)
            from .messaging import unread_counts
            rows = db.execute("SELECT data FROM orders" + clause + " ORDER BY created_at DESC, id DESC", args)
            return 200, {"orders": [projected_order(json.loads(row["data"]), user) for row in rows],
                         "unread": unread_counts(db, user)}, None
        if method == "POST" and path == "/api/orders":
            return self.create_order(db, data)
        match = re.fullmatch(r"/api/restaurants/([A-Za-z0-9-]+)/products/([A-Za-z0-9-]+)", path)
        if method == "PATCH" and match:
            restaurant = self.managed_restaurant(db, match[1])
            if set(data) != {"available"} or type(data.get("available")) is not bool:
                raise APIError(400, "La disponibilité doit être vraie ou fausse.")
            row = db.execute("SELECT * FROM products WHERE id = ? AND restaurant_id = ?", (match[2], match[1])).fetchone()
            if not row:
                raise APIError(404, "Produit introuvable dans ce restaurant.")
            product = self.state.database.product(row)
            if product["available"] != data["available"]:
                product["available"] = data["available"]
                product["version"] += 1
                db.execute("UPDATE products SET available = ?, data = ? WHERE id = ?", (int(product["available"]), json.dumps({key: value for key, value in product.items() if key != "available"}, ensure_ascii=False), match[2]))
                restaurant_data = json.loads(restaurant["data"])
                restaurant_data["menuVersion"] += 1
                db.execute("UPDATE restaurants SET data = ? WHERE id = ?", (json.dumps(restaurant_data, ensure_ascii=False), match[1]))
            return 200, {"product": product}, None
        raise APIError(404, "Cette ressource API n’existe pas.")

    def create_order(self, db, data):
        from .marketplace import ACCEPTANCE_SECONDS, selected_price, shifted
        from .promotions import evaluate, normalized_code, record_use
        user = self.user(db, {"client"})
        request_id = text_field(data, "requestId", 36, 36)
        try:
            if str(uuid.UUID(request_id)) != request_id.lower():
                raise ValueError()
        except ValueError:
            raise APIError(400, "L’identifiant de commande est invalide.")
        request_hash = hashlib.sha256(json.dumps({key: value for key, value in data.items() if key != "requestId"}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        existing = db.execute("SELECT * FROM orders WHERE customer_id = ? AND request_id = ?", (user["id"], request_id)).fetchone()
        if existing:
            if existing["request_hash"] != request_hash:
                raise APIError(409, "Cet identifiant correspond déjà à une autre commande.")
            return 200, {"order": json.loads(existing["data"])}, None
        # Old clients must explicitly refresh their basket; never silently adopt
        # a changed menu price or turn a previous fixed option into a new choice.
        if type(data.get("expectedTotal")) is not int:
            raise APIError(409, "La carte a évolué. Rechargez la page et mettez votre panier à jour avant de commander.")
        running = db.execute("SELECT COUNT(*) FROM orders JOIN order_assignments ON orders.id = order_assignments.order_id "
                             "WHERE customer_id = ? AND state NOT IN ('delivered','cancelled')", (user["id"],)).fetchone()[0]
        if running >= 5:
            raise APIError(409, "Vous avez déjà cinq commandes en cours dans cette démonstration. Terminez-les ou annulez-en une.")
        restaurant_id = text_field(data, "restaurantId", 1, 80)
        row = db.execute("SELECT * FROM restaurants WHERE id = ?", (restaurant_id,)).fetchone()
        if not row:
            raise APIError(404, "Restaurant introuvable.")
        if not row["accepting_orders"]:
            raise APIError(409, "Ce restaurant n’accepte pas de commandes pour le moment.")
        restaurant = json.loads(row["data"])
        customer_name = text_field(data, "customerName", 2, 100)
        phone = text_field(data, "phone", 10, 30)
        if not re.fullmatch(r"\+?\d{10,15}", re.sub(r"[\s().-]", "", phone)):
            raise APIError(400, "Le numéro de téléphone est invalide.")
        address = text_field(data, "address", 5, 250)
        city = text_field(data, "city", 1, 50)
        if city not in CITIES:
            raise APIError(400, "Cette ville n’est pas desservie dans la démo.")
        details = text_field(data, "details", 0, 300)
        notes = text_field(data, "notes", 0, 500)
        raw_items = data.get("items")
        if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= 50:
            raise APIError(400, "Le panier doit contenir entre 1 et 50 lignes.")
        items, seen = [], set()
        for item in raw_items:
            if not isinstance(item, dict):
                raise APIError(400, "Une ligne de panier est invalide.")
            product_id = text_field(item, "productId", 1, 100)
            product_row = db.execute("SELECT * FROM products WHERE id = ? AND restaurant_id = ?", (product_id, restaurant_id)).fetchone()
            if not product_row:
                raise APIError(400, "Un produit n’appartient pas à ce restaurant.")
            if not product_row["available"]:
                raise APIError(409, "Un produit de votre panier est indisponible.")
            product = json.loads(product_row["data"])
            if product.get("archived"):
                raise APIError(409, "Un produit de votre panier a été retiré de la carte.")
            quantity = item.get("quantity")
            if type(quantity) is not int or not 1 <= quantity <= 20:
                raise APIError(400, "La quantité doit être comprise entre 1 et 20.")
            if type(item.get("productVersion")) is not int or item["productVersion"] != product["version"] or type(item.get("unitPrice")) is not int:
                raise APIError(409, "Un produit a changé. Mettez votre panier à jour et confirmez les nouveaux choix.")
            price, label, selections = selected_price(product, item.get("selections"))
            if item["unitPrice"] != price:
                raise APIError(409, "Le prix d’un produit a changé. Mettez votre panier à jour.")
            item_key = (product_id, json.dumps(selections, sort_keys=True))
            if item_key in seen:
                raise APIError(400, "Regroupez les quantités des produits identiques.")
            seen.add(item_key)
            items.append({"productId": product_id, "name": product["name"], "option": label,
                          "price": price, "quantity": quantity, "selections": selections,
                          "productVersion": product["version"]})
        count = sum(item["quantity"] for item in items)
        if count > 100:
            raise APIError(400, "Le panier est limité à 100 articles pour cette démonstration.")
        subtotal = sum(item["price"] * item["quantity"] for item in items)
        delivery = restaurant["delivery"] + (0 if city == "Cayenne" else 100)
        code = normalized_code(data.get("promoCode"), required=False)
        promo, discount = (None, 0)
        if code:
            promo, discount = evaluate(db, code, user, restaurant_id, subtotal, delivery)
        if data["expectedTotal"] != subtotal + delivery - discount:
            raise APIError(409, "Le total a changé. Vérifiez votre panier avant de confirmer la commande.")
        stamp = now_iso()
        order = {
            "id": "MJ-" + uuid.uuid4().hex[:12].upper(),
            "restaurantId": restaurant_id, "restaurant": restaurant["name"],
            "customerId": user["id"], "customerName": customer_name,
            "phone": phone, "address": address, "city": city, "details": details, "notes": notes,
            "status": "pending", "subtotal": subtotal, "delivery": delivery,
            "discount": discount, "total": subtotal + delivery - discount,
            "promoCode": promo["code"] if promo else None, "promoLabel": promo["label"] if promo else "",
            "acceptBy": shifted(stamp, ACCEPTANCE_SECONDS), "eta": None,
            "count": count, "date": stamp, "updatedAt": stamp, "items": items,
            "history": [{"status": "pending", "date": stamp}],
            "courierId": None, "courierName": None,
            "pickupAddress": restaurant["pickupAddress"], "pickupCity": restaurant["pickupCity"],
            "deliveryCode": "%04d" % secrets.randbelow(10_000),
        }
        db.execute("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)", (order["id"], user["id"], restaurant_id, request_id, request_hash, stamp, json.dumps(order, ensure_ascii=False)))
        db.execute("INSERT INTO order_assignments(order_id, courier_id, state) VALUES (?, ?, ?)", (order["id"], None, "pending"))
        record_use(db, order, user)
        return 201, {"order": order}, None

    def serve_static(self, path):
        decoded = unquote(path)
        target = (self.server.static_dir / decoded.lstrip("/")).resolve()
        try:
            target.relative_to(self.server.static_dir)
        except ValueError:
            raise APIError(404, "Fichier introuvable.")
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file() and not Path(decoded).suffix:
            target = self.server.static_dir / "index.html"
        if not target.is_file():
            raise APIError(404, "Interface introuvable. Exécutez npm run build avant de démarrer le serveur.")
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(str(target))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Serveur de démonstration Manjéo")
    parser.add_argument("--port", type=int, default=5173)
    args = parser.parse_args()
    database = create_database_from_environment()
    server = ManjeoServer(("127.0.0.1", args.port), database)
    print("Manjéo : http://127.0.0.1:%d/" % args.port, flush=True)
    print("Base : PostgreSQL" if hasattr(database, "dsn") else "Base SQLite : %s" % Path(database.path).resolve(), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    # Keep the package identity consistent when launched with `python server/app.py`.
    import sys
    sys.path.insert(0, str(ROOT))
    from server.app import main as run
    run()
