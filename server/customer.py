"""Owner-only saved delivery addresses and short-lived geocoding confirmations."""
import hashlib
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from .app import APIError, now_iso, text_field
from .addresses import CITY_CODES, AddressServiceUnavailable, geocode

TOKEN_SECONDS = 15 * 60
VERIFICATION_SECONDS = 30 * 24 * 60 * 60


def initialize_customer(db):
    for statement in (
        """CREATE TABLE IF NOT EXISTS customer_addresses (
            user_id TEXT PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS customer_preferences (
            user_id TEXT PRIMARY KEY REFERENCES users(id),
            payment_method TEXT NOT NULL CHECK (payment_method IN ('demo','stripe'))
        )""",
        """CREATE TABLE IF NOT EXISTS address_verifications (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
            data TEXT NOT NULL, expires_at DOUBLE PRECISION NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS address_verifications_user ON address_verifications(user_id, expires_at)",
        """CREATE TABLE IF NOT EXISTS address_verification_usage (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), attempted_at DOUBLE PRECISION NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS address_verification_usage_time ON address_verification_usage(attempted_at)",
    ):
        db.execute(statement)


def _instant(stamp=None):
    return datetime.fromisoformat((stamp or now_iso()).replace("Z", "+00:00"))


def _iso(instant):
    return instant.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _identity(address):
    return " ".join(address.split()).casefold()


def _address_fields(data):
    address = text_field(data, "address", 5, 250)
    city = text_field(data, "city", 1, 80)
    if city not in CITY_CODES:
        raise APIError(400, "Cette commune n’est pas desservie.")
    details = text_field(data, "details", 0, 300) if "details" in data else ""
    return address, city, details


def delivery_address(db, user_id):
    row = db.execute("SELECT data FROM customer_addresses WHERE user_id = ?", (user_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def payment_method(db, user_id):
    row = db.execute("SELECT payment_method FROM customer_preferences WHERE user_id = ?", (user_id,)).fetchone()
    return row["payment_method"] if row else "demo"


def update_payment_method(db, user, value):
    if user["role"] != "client":
        raise APIError(403, "Seul le client peut enregistrer une préférence de paiement.")
    if not isinstance(value, str) or value not in {"demo", "stripe"}:
        raise APIError(400, "Ce mode de paiement n’est pas proposé.")
    db.execute("INSERT INTO customer_preferences(user_id,payment_method) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET payment_method=excluded.payment_method",
               (user["id"], value))


def issue_verification(db, user_id, candidate, stamp=None):
    """Internal helper after a real geocode; tests may supply isolated fixtures."""
    instant = _instant(stamp)
    token = secrets.token_urlsafe(32)
    value = {key: candidate[key] for key in ("address", "city", "latitude", "longitude", "provider", "precision")}
    value["verifiedAt"] = _iso(instant)
    expires = instant + timedelta(seconds=TOKEN_SECONDS)
    db.execute("INSERT INTO address_verifications(token_hash,user_id,data,expires_at) VALUES (?,?,?,?)",
               (hashlib.sha256(token.encode()).hexdigest(), user_id, json.dumps(value, ensure_ascii=False), expires.timestamp()))
    return {**value, "verificationToken": token, "expiresAt": _iso(expires)}


def _quota(db, user_id, instant):
    try:
        per_minute = int(os.environ.get("MANJEO_ADDRESS_REQUESTS_PER_MINUTE", "10"))
        per_day = int(os.environ.get("MANJEO_ADDRESS_REQUESTS_PER_DAY", "200"))
        if not (1 <= per_minute <= 100 and 1 <= per_day <= 10000):
            raise ValueError()
    except ValueError:
        raise APIError(503, "La vérification d’adresse est temporairement indisponible.") from None
    stamp = instant.timestamp()
    db.execute("DELETE FROM address_verifications WHERE expires_at <= ?", (stamp,))
    db.execute("DELETE FROM address_verification_usage WHERE attempted_at < ?", (stamp - 2 * 86400,))
    count = db.execute("SELECT COUNT(*) FROM address_verification_usage WHERE user_id = ? AND attempted_at > ?", (user_id, stamp - 60)).fetchone()[0]
    if count >= per_minute:
        raise APIError(429, "Trop de vérifications d’adresse. Réessayez dans une minute.")
    count = db.execute("SELECT COUNT(*) FROM address_verification_usage WHERE attempted_at >= ?", (instant.replace(hour=0, minute=0, second=0, microsecond=0).timestamp(),)).fetchone()[0]
    if count >= per_day:
        raise APIError(429, "Le quota quotidien de vérification d’adresses est atteint. Réessayez demain.")
    db.execute("INSERT INTO address_verification_usage(id,user_id,attempted_at) VALUES (?,?,?)", (secrets.token_hex(16), user_id, stamp))


def verify_address_request(handler, data):
    database = handler.state.database
    with database.connect() as db:
        user = handler.user(db, {"client"})
        if not isinstance(data, dict) or set(data) != {"address", "city"}:
            raise APIError(400, "Les champs de vérification d’adresse sont invalides.")
        address, city, _ = _address_fields(data)
        database.begin_write(db)
        _quota(db, user["id"], _instant())
    try:
        result = geocode(address, city)
    except AddressServiceUnavailable:
        raise APIError(503, "La vérification d’adresse est temporairement indisponible. Réessayez dans quelques instants.") from None
    # Neither an open connection nor the cross-instance write lock spans network.
    with database.connect() as db:
        current = handler.user(db, {"client"})
        if current["id"] != user["id"]:
            raise APIError(409, "Le compte connecté a changé. Vérifiez de nouveau l’adresse.")
        database.begin_write(db)
        candidates = [issue_verification(db, user["id"], candidate) for candidate in result["candidates"]]
    response = {"candidates": candidates, "source": result["source"]}
    if result.get("note"):
        response["note"] = result["note"]
    if not candidates:
        response["note"] = "Aucune adresse précise trouvée. Ajoutez le numéro et le nom de la voie, puis réessayez."
    return 200, response, None


def _proof(db, user_id, token, instant):
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise APIError(409, "Vérifiez et confirmez l’adresse de livraison avant de continuer.")
    row = db.execute("SELECT data,expires_at FROM address_verifications WHERE token_hash = ? AND user_id = ?",
                     (hashlib.sha256(token.encode()).hexdigest(), user_id)).fetchone()
    if not row or row["expires_at"] <= instant.timestamp():
        raise APIError(409, "La vérification d’adresse a expiré. Vérifiez de nouveau l’adresse.")
    return json.loads(row["data"])


def _matches(proof, address, city):
    return proof and _identity(proof["address"]) == _identity(address) and proof["city"] == city


def _saved_valid(proof, instant):
    return proof and instant < _instant(proof["verificationExpiresAt"])


def _confirmed(proof, details, instant):
    return {**{key: proof[key] for key in ("address", "city", "latitude", "longitude", "provider", "precision", "verifiedAt")},
            "details": details, "confirmedAt": _iso(instant),
            "verificationExpiresAt": _iso(_instant(proof["verifiedAt"]) + timedelta(seconds=VERIFICATION_SECONDS))}


def update_delivery_address(db, user, data):
    if user["role"] != "client":
        raise APIError(403, "Seul le client peut enregistrer une adresse de livraison.")
    if data is None:
        db.execute("DELETE FROM customer_addresses WHERE user_id = ?", (user["id"],))
        return
    if not isinstance(data, dict) or set(data) - {"address", "city", "details", "verificationToken"}:
        raise APIError(400, "Les champs de l’adresse de livraison sont invalides.")
    address, city, details = _address_fields(data)
    instant = _instant()
    if "verificationToken" in data:
        proof = _proof(db, user["id"], data["verificationToken"], instant)
    else:
        proof = delivery_address(db, user["id"])
        if not _saved_valid(proof, instant):
            raise APIError(409, "Vérifiez et confirmez l’adresse de livraison avant de continuer.")
    if not _matches(proof, address, city):
        raise APIError(409, "L’adresse a changé. Vérifiez et confirmez la nouvelle adresse.")
    value = _confirmed(proof, details, instant)
    db.execute("INSERT INTO customer_addresses(user_id,data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
               (user["id"], json.dumps(value, ensure_ascii=False)))


def checkout_address(db, user, data):
    """Validate after request-id replay and cart checks, inside order transaction."""
    if user["role"] != "client":
        raise APIError(403, "Seul le client peut confirmer une adresse de livraison.")
    address, city, details = _address_fields(data)
    instant = _instant()
    if "useDefaultAddress" in data and not isinstance(data["useDefaultAddress"], bool):
        raise APIError(400, "Le choix de l’adresse enregistrée est invalide.")
    if data.get("useDefaultAddress") is True:
        if "addressVerificationToken" in data:
            raise APIError(400, "Choisissez une seule méthode de confirmation d’adresse.")
        proof = delivery_address(db, user["id"])
        if not _saved_valid(proof, instant):
            raise APIError(409, "L’adresse enregistrée doit être vérifiée de nouveau.")
    else:
        proof = _proof(db, user["id"], data.get("addressVerificationToken"), instant)
    if not _matches(proof, address, city):
        raise APIError(409, "L’adresse a changé. Vérifiez et confirmez la nouvelle adresse.")
    value = _confirmed(proof, details, instant)
    return {"address": value["address"], "city": value["city"], "details": details,
            "deliveryLocation": {key: value[key] for key in ("latitude", "longitude", "provider", "precision", "verifiedAt", "confirmedAt")}}
