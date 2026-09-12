"""Stripe hosted Checkout, deliberately restricted to test payments.

External calls own short, separate DB transactions: never hold the application
write lock while contacting Stripe. Only a verified webhook may unlock an order.
"""
import hashlib
import hmac
import http.client
import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .app import APIError, now_iso

STRIPE_VERSION = "2025-06-30.basil"
MAX_WEBHOOK_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 256 * 1024
CHECKOUT_SECONDS = 3600
SIGNATURE_TOLERANCE = 300
UNAVAILABLE = "Le paiement Stripe de test n’est pas configuré. La démonstration reste disponible."


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def epoch(value):
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())


def future(stamp, seconds):
    return (datetime.fromisoformat(stamp.replace("Z", "+00:00")) + timedelta(seconds=seconds)).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def configuration():
    """No credential, account ID or webhook secret is returned to the browser."""
    mode = os.environ.get("MANJEO_PAYMENT_MODE", "demo").strip()
    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
    origin = os.environ.get("APP_ORIGIN", "").strip().rstrip("/")
    try:
        parsed = urlsplit(origin)
        parsed.port
    except ValueError:
        parsed = urlsplit("")
    safe_origin = (parsed.scheme == "https" and bool(parsed.hostname) or
                   parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"})
    safe_origin = safe_origin and not (parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment)
    ready = bool(mode == "stripe_test" and re.fullmatch(r"sk_test_[A-Za-z0-9]+", key)
                 and re.fullmatch(r"whsec_[A-Za-z0-9]+", secret) and safe_origin)
    return {"mode": "stripe_test" if mode == "stripe_test" else "demo",
            "stripeAvailable": ready, "reason": None if ready else UNAVAILABLE}


def require_configured():
    if not configuration()["stripeAvailable"]:
        raise APIError(503, UNAVAILABLE)


def validate_requested_payment(data):
    method = data.get("paymentMethod", "demo")
    if not isinstance(method, str) or method not in {"demo", "stripe"}:
        raise APIError(400, "Le mode de paiement est invalide.")
    if method == "stripe":
        require_configured()
    return method


def prepare_order_payment(order, method):
    """Call after server price validation, before inserting the new order."""
    if method not in {"demo", "stripe"}:
        raise APIError(400, "Le mode de paiement est invalide.")
    order["payment"] = {"provider": method, "status": "simulated" if method == "demo" else "awaiting_payment", "testMode": True}
    if method == "stripe":
        require_configured()
        if type(order["total"]) is not int or not 50 <= order["total"] <= 99_999_999:
            raise APIError(400, "Le total du paiement de test doit être compris entre 0,50 € et 999 999,99 €.")
        order["status"] = "awaiting_payment"
        order["acceptBy"] = None
        order["history"] = [{"status": "awaiting_payment", "date": order["date"]}]
        order["payment"]["expiresAt"] = future(order["date"], CHECKOUT_SECONDS)


def initialize_payments(db):
    for statement in (
        """CREATE TABLE IF NOT EXISTS order_payments (
            order_id TEXT PRIMARY KEY REFERENCES orders(id),
            payment_id TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL REFERENCES users(id),
            amount BIGINT NOT NULL, currency TEXT NOT NULL,
            status TEXT NOT NULL, expires_at BIGINT NOT NULL,
            checkout_parameters TEXT, session_id TEXT UNIQUE, checkout_url TEXT,
            payment_intent_id TEXT UNIQUE, refund_id TEXT UNIQUE,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS payment_events (
            event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
            object_id TEXT NOT NULL, received_at TEXT NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS payments_status_expiry ON order_payments(status, expires_at)",
    ):
        db.execute(statement)


def register_payment(db, order):
    if order.get("payment", {}).get("provider") != "stripe":
        return
    db.execute("""INSERT INTO order_payments
        (order_id,payment_id,customer_id,amount,currency,status,expires_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)""", (order["id"], uuid.uuid4().hex, order["customerId"], order["total"],
        "eur", "awaiting_payment", epoch(order["payment"]["expiresAt"]), order["date"], order["date"]))


def write_payment(db, order, payment_status, stamp=None):
    stamp = stamp or now_iso()
    order["payment"] = {**order.get("payment", {}), "provider": "stripe", "status": payment_status, "testMode": True}
    order["updatedAt"] = stamp
    db.execute("UPDATE order_payments SET status=?, updated_at=? WHERE order_id=?", (payment_status, stamp, order["id"]))
    db.execute("UPDATE orders SET data=? WHERE id=?", (dumps(order), order["id"]))


def cancel_payment(db, order):
    """Hook inside the transaction for every order cancellation, before save."""
    row = db.execute("SELECT * FROM order_payments WHERE order_id=?", (order["id"],)).fetchone()
    if not row:
        return
    status = row["status"]
    if status == "paid":
        status = "refund_pending"
    elif status == "awaiting_payment":
        status = "cancelled"
    write_payment(db, order, status)


def cancel_waiting_order(db, order, payment_status, stamp):
    if order["status"] != "awaiting_payment":
        return
    from .promotions import release_use
    order["status"] = "cancelled"
    order["acceptBy"] = None
    order["history"].append({"status": "cancelled", "date": stamp, "label": "Paiement de test expiré — commande annulée"})
    db.execute("UPDATE order_assignments SET state='cancelled' WHERE order_id=?", (order["id"],))
    release_use(db, order["id"])
    write_payment(db, order, payment_status, stamp)


def expire_awaiting_payments(db, stamp=None):
    """No scheduler is implied; the caller already holds the write transaction."""
    stamp = stamp or now_iso()
    for row in db.execute("""SELECT orders.data FROM orders JOIN order_payments
            ON orders.id=order_payments.order_id WHERE order_payments.status='awaiting_payment'
            AND order_payments.expires_at<=?""", (epoch(stamp),)).fetchall():
        cancel_waiting_order(db, json.loads(row["data"]), "expired", stamp)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def stripe_request(method, path, parameters=None, idempotency_key=None):
    require_configured()
    if not re.fullmatch(r"/(?:checkout/sessions(?:/cs_test_[A-Za-z0-9]+(?:/expire)?)?|refunds(?:/re_[A-Za-z0-9]+)?)", path):
        raise APIError(502, "La requête de paiement est invalide.")
    headers = {"Authorization": "Bearer " + os.environ["STRIPE_SECRET_KEY"].strip(),
               "Stripe-Version": STRIPE_VERSION, "Accept": "application/json"}
    body = None
    if method == "POST":
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        headers["Idempotency-Key"] = idempotency_key
        body = urlencode(parameters or {}).encode("utf-8")
    request = Request("https://api.stripe.com/v1" + path, data=body, headers=headers, method=method)
    try:
        with build_opener(NoRedirect()).open(request, timeout=8) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError()
        payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get("livemode") is True:
            raise ValueError()
        return payload
    except (HTTPError, URLError, TimeoutError, OSError, http.client.HTTPException, ValueError, UnicodeError, RecursionError):
        # Provider errors can include API keys, request bodies and card details.
        raise APIError(503, "Stripe est momentanément indisponible. Réessayez le paiement de test.") from None


def owned_payment(handler, db, order_id, admin=False):
    user = handler.user(db, {"admin"} if admin else {"client"})
    row = db.execute("SELECT * FROM order_payments WHERE order_id=?", (order_id,)).fetchone()
    if not row or not admin and row["customer_id"] != user["id"]:
        raise APIError(404, "Paiement introuvable.")
    order = json.loads(db.execute("SELECT data FROM orders WHERE id=?", (order_id,)).fetchone()["data"])
    return row, order


def metadata(row):
    return {"payment_id": row["payment_id"], "order_id": row["order_id"], "customer_id": row["customer_id"]}


def session_parameters(row, order, locale):
    origin = os.environ["APP_ORIGIN"].strip().rstrip("/")
    parameters = {
        "mode": "payment", "payment_method_types[0]": "card", "locale": "pt-BR" if locale == "pt" else "fr",
        "client_reference_id": order["id"], "expires_at": row["expires_at"],
        "success_url": origin + "/?payment=return&order=" + order["id"],
        "cancel_url": origin + "/?payment=cancel&order=" + order["id"],
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": row["amount"],
        "line_items[0][price_data][product_data][name]": "Manjéo — " + order["id"],
        "line_items[0][quantity]": 1,
    }
    for key, value in metadata(row).items():
        parameters["metadata[" + key + "]"] = value
        parameters["payment_intent_data[metadata][" + key + "]"] = value
    return parameters


def valid_session(session, row):
    sid = session.get("id")
    if (not isinstance(sid, str) or not re.fullmatch(r"cs_test_[A-Za-z0-9]+", sid)
        or session.get("object") != "checkout.session" or session.get("livemode") is not False
        or session.get("mode") != "payment" or type(session.get("amount_total")) is not int
        or session["amount_total"] != row["amount"] or session.get("currency") != row["currency"]
        or session.get("client_reference_id") != row["order_id"]
        or session.get("metadata") != metadata(row)
        or row["session_id"] and row["session_id"] != sid):
        raise APIError(400, "Le paiement reçu ne correspond pas à la commande.")
    return sid


def create_checkout(handler, order_id, data):
    if set(data) - {"language"}:
        raise APIError(400, "La demande de paiement contient des champs non autorisés.")
    locale = data.get("language", "fr")
    if not isinstance(locale, str) or locale not in {"fr", "ht", "pt"}:
        raise APIError(400, "La langue du paiement est invalide.")
    database = handler.state.database
    with database.connect() as db:
        database.begin_write(db)
        row, order = owned_payment(handler, db, order_id)
        require_configured()
        if row["status"] != "awaiting_payment" or order["status"] != "awaiting_payment":
            raise APIError(409, "Cette commande n’attend plus de paiement.")
        expired = row["expires_at"] <= int(time.time())
        if expired:
            # This route owns its transactions and bypasses the generic expiry
            # sweep. Commit the cancellation before returning its refusal.
            cancel_waiting_order(db, order, "expired", now_iso())
        elif row["checkout_url"]:
            return {"checkoutUrl": row["checkout_url"], "orderId": order_id}
        elif row["checkout_parameters"]:
            parameters = json.loads(row["checkout_parameters"])
        else:
            # Stripe requires >=30 minutes from session creation. A draft that
            # has already waited longer must be cancelled rather than extended.
            if row["expires_at"] <= int(time.time()) + 1800:
                raise APIError(409, "Ce paiement a expiré. Annulez la commande et recommencez.")
            parameters = session_parameters(row, order, locale)
            db.execute("UPDATE order_payments SET checkout_parameters=? WHERE order_id=?", (dumps(parameters), order_id))
    if expired:
        raise APIError(409, "Cette commande n’attend plus de paiement.")
    session = stripe_request("POST", "/checkout/sessions", parameters, "manjeo:" + row["payment_id"] + ":checkout")
    sid = valid_session(session, row)
    url = session.get("url")
    try:
        parsed = urlsplit(url) if isinstance(url, str) else None
    except ValueError:
        parsed = None
    if not parsed or parsed.scheme != "https" or parsed.netloc != "checkout.stripe.com" or parsed.username or session.get("status") != "open":
        raise APIError(502, "La page de paiement de test est indisponible.")
    with database.connect() as db:
        database.begin_write(db)
        current, order = owned_payment(handler, db, order_id)
        valid_session(session, current)
        db.execute("UPDATE order_payments SET session_id=?, checkout_url=? WHERE order_id=?", (sid, url, order_id))
        if current["expires_at"] <= int(time.time()):
            cancel_waiting_order(db, order, "expired", now_iso())
        waiting = current["status"] == "awaiting_payment" and order["status"] == "awaiting_payment"
    if not waiting:
        # Persist the session ID even if cancellation won the network race, so
        # any later webhook remains associated and can require a test refund.
        try:
            stripe_request("POST", "/checkout/sessions/" + sid + "/expire", {}, "manjeo:" + row["payment_id"] + ":expire")
        except APIError:
            pass
        raise APIError(409, "Cette commande n’attend plus de paiement.")
    return {"checkoutUrl": url, "orderId": order_id}


def verify_webhook(raw, signature, stamp=None):
    require_configured()
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_WEBHOOK_BYTES or not isinstance(signature, str) or len(signature) > 4096:
        raise APIError(400, "Le webhook de paiement est invalide.")
    fields = [part.strip().split("=", 1) for part in signature.split(",")]
    timestamps = [value for item in fields if len(item) == 2 for key, value in [item] if key == "t"]
    signatures = [value for item in fields if len(item) == 2 for key, value in [item] if key == "v1"]
    if len(timestamps) != 1 or not re.fullmatch(r"[0-9]{1,12}", timestamps[0]) or abs((int(time.time()) if stamp is None else stamp) - int(timestamps[0])) > SIGNATURE_TOLERANCE:
        raise APIError(400, "La signature du paiement est invalide ou trop ancienne.")
    digest = hmac.new(os.environ["STRIPE_WEBHOOK_SECRET"].strip().encode(), timestamps[0].encode() + b"." + raw, hashlib.sha256).hexdigest()
    if not any(re.fullmatch(r"[a-f0-9]{64}", value) and hmac.compare_digest(digest, value) for value in signatures):
        raise APIError(400, "La signature du paiement est invalide ou trop ancienne.")
    try:
        event = json.loads(raw)
        from .app import validate_json_value
        validate_json_value(event)
    except (ValueError, UnicodeError, RecursionError):
        raise APIError(400, "Le webhook de paiement est invalide.") from None
    if not isinstance(event, dict) or event.get("livemode") is not False or event.get("object") != "event" or not isinstance(event.get("id"), str) or not re.fullmatch(r"evt_[A-Za-z0-9]+", event["id"]) or not isinstance(event.get("type"), str):
        raise APIError(400, "Seuls les événements Stripe de test sont autorisés.")
    return event


def apply_webhook(database, event):
    kind = event["type"]
    supported = {"checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "refund.created", "refund.updated", "refund.failed"}
    if kind not in supported:
        return {"received": True, "ignored": True}
    obj = event.get("data", {}).get("object") if isinstance(event.get("data"), dict) else None
    if not isinstance(obj, dict) or not isinstance(obj.get("id"), str):
        raise APIError(400, "Le webhook de paiement est invalide.")
    with database.connect() as db:
        database.begin_write(db)
        stamp = now_iso()
        if db.execute("SELECT event_id FROM payment_events WHERE event_id=?", (event["id"],)).fetchone():
            return {"received": True, "duplicate": True}
        meta = obj.get("metadata")
        payment_id = meta.get("payment_id") if isinstance(meta, dict) else None
        if not isinstance(payment_id, str):
            return {"received": True, "ignored": True}
        row = db.execute("SELECT * FROM order_payments WHERE payment_id=?", (payment_id,)).fetchone()
        if not row:
            # A single Stripe sandbox can serve different isolated deployments.
            return {"received": True, "ignored": True}
        order = json.loads(db.execute("SELECT data FROM orders WHERE id=?", (row["order_id"],)).fetchone()["data"])
        if kind.startswith("checkout.session."):
            sid = valid_session(obj, row)
            if kind == "checkout.session.expired":
                if obj.get("status") != "expired" or obj.get("payment_status") != "unpaid":
                    raise APIError(400, "L’expiration du paiement est incohérente.")
                if row["status"] == "awaiting_payment":
                    cancel_waiting_order(db, order, "expired", stamp)
            elif obj.get("payment_status") == "paid":
                intent = obj.get("payment_intent")
                if obj.get("status") != "complete" or not isinstance(intent, str) or not re.fullmatch(r"pi_[A-Za-z0-9]+", intent) or row["payment_intent_id"] and row["payment_intent_id"] != intent:
                    raise APIError(400, "La confirmation du paiement est incohérente.")
                db.execute("UPDATE order_payments SET session_id=?, payment_intent_id=? WHERE order_id=?", (sid, intent, order["id"]))
                if row["status"] in {"awaiting_payment", "cancelled", "expired"}:
                    if order["status"] == "awaiting_payment" and row["expires_at"] > int(time.time()):
                        order["status"] = "pending"
                        order["acceptBy"] = future(stamp, 600)
                        order["history"].append({"status": "pending", "date": stamp, "label": "Paiement de test confirmé"})
                        db.execute("UPDATE order_assignments SET state='pending' WHERE order_id=?", (order["id"],))
                        write_payment(db, order, "paid", stamp)
                    else:
                        if order["status"] == "awaiting_payment":
                            cancel_waiting_order(db, order, "expired", stamp)
                        write_payment(db, order, "refund_pending", stamp)
            # completed/unpaid is acknowledged but never unlocks the kitchen.
        else:
            if (obj.get("object") != "refund" or obj.get("livemode") is True or meta != metadata(row)
                or not re.fullmatch(r"re_[A-Za-z0-9]+", obj["id"])
                or obj.get("payment_intent") != row["payment_intent_id"] or not row["payment_intent_id"]
                or type(obj.get("amount")) is not int or obj["amount"] != row["amount"]
                or obj.get("currency") != row["currency"]
                or row["refund_id"] and row["refund_id"] != obj["id"]):
                raise APIError(400, "Le remboursement reçu ne correspond pas à la commande.")
            if order["status"] != "cancelled":
                raise APIError(409, "La commande doit être annulée avant son remboursement.")
            status = obj.get("status")
            if not isinstance(status, str) or status not in {"succeeded", "failed", "canceled", "pending", "requires_action"}:
                raise APIError(400, "Le statut du remboursement est invalide.")
            db.execute("UPDATE order_payments SET refund_id=? WHERE order_id=?", (obj["id"], order["id"]))
            if row["status"] != "refunded" and not (row["status"] == "refund_failed" and status in {"pending", "requires_action"}):
                write_payment(db, order, "refunded" if status == "succeeded" else "refund_failed" if status in {"failed", "canceled"} else "refund_pending", stamp)
        db.execute("INSERT INTO payment_events VALUES (?,?,?,?)", (event["id"], kind, obj["id"], stamp))
    return {"received": True}


def request_refund(handler, order_id):
    database = handler.state.database
    with database.connect() as db:
        database.begin_write(db)
        row, order = owned_payment(handler, db, order_id, admin=True)
        require_configured()
        if order["status"] != "cancelled" or row["status"] not in {"refund_pending", "refund_failed", "refunded"} or not row["payment_intent_id"]:
            raise APIError(409, "Ce paiement ne peut pas être remboursé depuis cet état.")
        if row["status"] == "refunded":
            return {"orderId": order_id, "payment": order["payment"]}
        if row["refund_id"]:
            # A terminal failed refund needs operator review in Stripe; creating
            # another refund blindly could duplicate a still-pending operation.
            if row["status"] == "refund_failed":
                raise APIError(409, "Ce remboursement a échoué. Vérifiez-le dans Stripe avant une nouvelle demande.")
            return {"orderId": order_id, "payment": order["payment"]}
        parameters = {"payment_intent": row["payment_intent_id"], "amount": row["amount"]}
        parameters.update({"metadata[" + key + "]": value for key, value in metadata(row).items()})
    refund = stripe_request("POST", "/refunds", parameters, "manjeo:" + row["payment_id"] + ":refund")
    if (refund.get("object") != "refund" or refund.get("livemode") is True or not isinstance(refund.get("id"), str) or not re.fullmatch(r"re_[A-Za-z0-9]+", refund["id"])
        or refund.get("payment_intent") != row["payment_intent_id"] or refund.get("metadata") != metadata(row)
        or type(refund.get("amount")) is not int or refund["amount"] != row["amount"] or refund.get("currency") != "eur"):
        raise APIError(502, "La réponse de remboursement est invalide.")
    with database.connect() as db:
        database.begin_write(db)
        current, order = owned_payment(handler, db, order_id, admin=True)
        if current["refund_id"] and current["refund_id"] != refund["id"]:
            raise APIError(409, "Un autre remboursement est déjà enregistré.")
        db.execute("UPDATE order_payments SET refund_id=? WHERE order_id=?", (refund["id"], order_id))
        # Even a synchronous 'succeeded' response is only a request receipt here.
        # The independently verified webhook confirms the actual refund status.
        if current["status"] not in {"refunded", "refund_failed"}:
            write_payment(db, order, "refund_pending")
    return {"orderId": order_id, "payment": order["payment"]}


def handle_payment_request(handler, path, data=None, raw_body=None):
    """Dispatch BEFORE the general API opens a DB connection/transaction."""
    if path == "/api/payments/config" and handler.command == "GET":
        return 200, configuration(), None
    if path == "/api/payments/stripe/webhook" and handler.command == "POST":
        event = verify_webhook(raw_body, handler.headers.get("Stripe-Signature", ""))
        return 200, apply_webhook(handler.state.database, event), None
    match = re.fullmatch(r"/api/orders/(MJ-[A-F0-9]{12})/(checkout|refund)", path)
    if match and handler.command == "POST":
        if not isinstance(data, dict):
            raise APIError(400, "La demande de paiement est invalide.")
        if match[2] == "refund" and data:
            raise APIError(400, "La demande de remboursement contient des champs non autorisés.")
        response = create_checkout(handler, match[1], data) if match[2] == "checkout" else request_refund(handler, match[1])
        return 200, response, None
    return None
