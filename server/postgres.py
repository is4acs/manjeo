"""PostgreSQL persistence for serverless deployments; no filesystem database."""
import os
import re
from contextlib import contextmanager
from pathlib import Path

from .app import APIError, Database, ROOT


class Record(dict):
    """Mapping rows with SQLite's positional access for the shared integration suite."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


def record_factory(cursor):
    columns = [column.name for column in cursor.description] if cursor.description else []
    return lambda values: Record(zip(columns, values))


class PostgresConnection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, parameters=()):
        # Only application-owned SQL uses this adapter; values stay bound parameters.
        # The shared queries have no question marks in literals or SQL comments.
        return self.connection.execute(statement.replace("?", "%s"), parameters)


class PostgresDatabase(Database):
    WRITE_LOCK = 731092616

    def __init__(self, dsn, catalog_path=None, schema=None):
        self.dsn = dsn
        self.schema = schema or os.environ.get("MANJEO_DB_SCHEMA", "manjeo")
        if not isinstance(self.schema, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", self.schema):
            raise ValueError("MANJEO_DB_SCHEMA must be a lowercase PostgreSQL identifier (1–63 characters).")
        self.catalog_path = Path(catalog_path or ROOT / "lib/catalog.json")
        try:
            import psycopg
        except ImportError:
            raise APIError(503, "Le connecteur de la base de données est indisponible.") from None
        self.driver = psycopg
        self.initialize()

    @contextmanager
    def raw_connection(self):
        try:
            with self.driver.connect(self.dsn, connect_timeout=10, prepare_threshold=None, row_factory=record_factory) as connection:
                yield connection
        except self.driver.OperationalError:
            # Credentials and connection strings must never appear in a JSON error or log.
            raise APIError(503, "La base de données en ligne est momentanément indisponible. Réessayez.") from None

    def set_schema(self, connection):
        # Validation is supplemented by driver quoting. SET LOCAL is pooler-compatible.
        connection.execute(self.driver.sql.SQL("SET LOCAL search_path TO {}, pg_catalog").format(self.driver.sql.Identifier(self.schema)))
        connection.execute("SET LOCAL lock_timeout = '10s'")
        connection.execute("SET LOCAL statement_timeout = '15s'")

    @contextmanager
    def connect(self):
        with self.raw_connection() as connection:
            self.set_schema(connection)
            yield PostgresConnection(connection)

    def begin_write(self, db):
        # The MVP deliberately preserves SQLite's serialized writes. The lock is
        # shared across function instances and releases on commit or rollback.
        db.execute("SELECT pg_advisory_xact_lock(?)", (self.WRITE_LOCK,))

    def initialize(self):
        with self.raw_connection() as connection:
            connection.execute("SET LOCAL lock_timeout = '10s'")
            connection.execute("SET LOCAL statement_timeout = '15s'")
            db = PostgresConnection(connection)
            self.begin_write(db)
            connection.execute(self.driver.sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(self.driver.sql.Identifier(self.schema)))
            self.set_schema(connection)
            for statement in (
                """CREATE TABLE IF NOT EXISTS restaurants (
                    id TEXT PRIMARY KEY, data TEXT NOT NULL,
                    accepting_orders INTEGER NOT NULL DEFAULT 1 CHECK (accepting_orders IN (0,1)),
                    sort_order INTEGER NOT NULL DEFAULT 0
                )""",
                """CREATE TABLE IF NOT EXISTS products (
                    id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
                    data TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
                    sort_order INTEGER NOT NULL DEFAULT 0
                )""",
                """CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('client','restaurant','admin')),
                    restaurant_id TEXT REFERENCES restaurants(id),
                    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL
                )""",
                "CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users(lower(email))",
                """CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    expires_at BIGINT NOT NULL
                )""",
                """CREATE TABLE IF NOT EXISTS orders (
                    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id),
                    restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
                    request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL, data TEXT NOT NULL,
                    UNIQUE(customer_id, request_id)
                )""",
                "CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id, created_at)",
                "CREATE INDEX IF NOT EXISTS orders_restaurant ON orders(restaurant_id, created_at)",
                """CREATE TABLE IF NOT EXISTS login_attempts (
                    key_hash TEXT NOT NULL, attempted_at BIGINT NOT NULL
                )""",
                "CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts(key_hash, attempted_at)",
            ):
                db.execute(statement)
            self.seed(db)
