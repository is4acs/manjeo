"""Profils, coordonnées et messagerie de commande.

Deux principes tiennent tout le module :
- les coordonnées ne sont ouvertes que pendant la fenêtre où elles servent, et
  se referment ensuite ; personne ne consulte l'annuaire de la démonstration ;
- un message est stocké dans la langue où il a été écrit. La traduction se fait
  à la lecture, pour chaque destinataire, et l'original reste toujours accessible.
"""
import re
import uuid
import hashlib
import json
from datetime import datetime, timezone

from .app import APIError, now_iso, text_field

# Langues proposées aux comptes. Le code sert de langue source et cible aux traductions.
LANGUAGES = {
    "fr": "Français",
    "ht": "Kreyòl ayisyen",
    "gcr": "Kréyol gwiyanè",
    "pt": "Português",
    "en": "English",
    "es": "Español",
    "zh": "中文",
}
# Réponses rapides : formulations préparées dans les langues proposées.
# Elles ne constituent pas un moteur de traduction des messages libres.
PHRASES = {
    "on_my_way": {
        "fr": "Je suis en route, j’arrive dans quelques minutes.",
        "ht": "Mwen sou wout la, m ap rive nan kèk minit.",
        "gcr": "Mo ka vini, mo ka rivé annan képi minit.",
        "pt": "Estou a caminho, chego em alguns minutos.",
        "en": "I’m on my way, I’ll be there in a few minutes.",
        "es": "Voy en camino, llego en unos minutos.",
        "zh": "我在路上，几分钟后到。",
    },
    "downstairs": {
        "fr": "Je suis en bas, devant l’entrée.",
        "ht": "Mwen anba a, devan pòt la.",
        "gcr": "Mo anba-a, douvan la pòt.",
        "pt": "Estou lá embaixo, na entrada.",
        "en": "I’m downstairs, at the entrance.",
        "es": "Estoy abajo, en la entrada.",
        "zh": "我在楼下门口。",
    },
    "cannot_find": {
        "fr": "Je ne trouve pas l’adresse, pouvez-vous me guider ?",
        "ht": "Mwen pa jwenn adrès la, èske ou ka gide mwen ?",
        "gcr": "Mo pa ka trouvé adrès-a, to pouvé gidé mo ?",
        "pt": "Não consigo encontrar o endereço, pode me orientar?",
        "en": "I can’t find the address, could you guide me?",
        "es": "No encuentro la dirección, ¿puede guiarme?",
        "zh": "我找不到地址，能指引我一下吗？",
    },
    "running_late": {
        "fr": "J’aurai un peu de retard, merci de votre patience.",
        "ht": "M ap gen yon ti reta, mèsi pou pasyans ou.",
        "gcr": "Mo ké gen roun ti rota, mèsi pou to pasyans.",
        "pt": "Vou me atrasar um pouco, obrigado pela paciência.",
        "en": "I’ll be slightly late, thank you for your patience.",
        "es": "Llegaré un poco tarde, gracias por su paciencia.",
        "zh": "我会晚一点到，谢谢您的耐心。",
    },
    "order_ready": {
        "fr": "La commande est prête pour le retrait.",
        "ht": "Kòmand lan pare pou ranmase.",
        "gcr": "Kòmand-a paré pou chèrché.",
        "pt": "O pedido está pronto para retirada.",
        "en": "The order is ready for pick-up.",
        "es": "El pedido está listo para recoger.",
        "zh": "订单已备好，可以取餐。",
    },
    "at_the_door": {
        "fr": "Je suis devant votre porte.",
        "ht": "Mwen devan pòt ou a.",
        "gcr": "Mo douvan to la pòt.",
        "pt": "Estou na sua porta.",
        "en": "I’m at your door.",
        "es": "Estoy en su puerta.",
        "zh": "我到您门口了。",
    },
    "thanks": {
        "fr": "Merci beaucoup, bonne journée !",
        "ht": "Mèsi anpil, bon jounen !",
        "gcr": "Mèsi anpil, bon jounen !",
        "pt": "Muito obrigado, bom dia!",
        "en": "Thank you very much, have a good day!",
        "es": "¡Muchas gracias, buen día!",
        "zh": "非常感谢，祝您愉快！",
    },
}
ACTIVE = {"accepted", "preparing", "ready", "picked_up"}
CLOSED_GRACE_SECONDS = 30 * 60


def initialize_messaging(db):
    for statement in (
        """CREATE TABLE IF NOT EXISTS user_profiles (
            user_id TEXT PRIMARY KEY REFERENCES users(id),
            phone TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'fr',
            updated_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS order_messages (
            id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
            sender_id TEXT NOT NULL REFERENCES users(id), sender_role TEXT NOT NULL,
            sender_name TEXT NOT NULL, body TEXT NOT NULL, language TEXT NOT NULL,
            phrase_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS order_messages_thread ON order_messages(order_id, created_at)",
        """CREATE TABLE IF NOT EXISTS order_message_reads (
            order_id TEXT NOT NULL REFERENCES orders(id),
            user_id TEXT NOT NULL REFERENCES users(id),
            last_read_at TEXT NOT NULL, PRIMARY KEY (order_id, user_id)
        )""",
    ):
        db.execute(statement)
    db.execute("""CREATE TABLE IF NOT EXISTS order_message_receipts (
        message_id TEXT NOT NULL REFERENCES order_messages(id),
        user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY (message_id, user_id)
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS order_message_requests (
        user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES orders(id), message_id TEXT NOT NULL REFERENCES order_messages(id),
        request_hash TEXT NOT NULL, PRIMARY KEY (user_id, request_id)
    )""")
    db.execute("CREATE TABLE IF NOT EXISTS messaging_migrations (id TEXT PRIMARY KEY)")
    if not db.execute("SELECT id FROM messaging_migrations WHERE id = 'message-receipts-v1'").fetchone():
        # Preserve the previous read state once, then track exact message IDs.
        # Timestamp-only cursors could swallow a message arriving in the same ms.
        db.execute("""INSERT INTO order_message_receipts(message_id, user_id)
            SELECT m.id, r.user_id FROM order_messages m JOIN order_message_reads r
            ON r.order_id = m.order_id WHERE m.created_at <= r.last_read_at
            ON CONFLICT(message_id, user_id) DO NOTHING""")
        db.execute("INSERT INTO messaging_migrations(id) VALUES ('message-receipts-v1')")
    # Coordonnées fictives des comptes de démonstration, posées une seule fois.
    for user_id, phone, language in (("demo-client", "0694 00 00 01", "fr"), ("demo-restaurant", "0694 00 00 02", "fr"),
                                     ("demo-courier", "0694 00 00 03", "ht"), ("demo-admin", "0694 00 00 04", "fr")):
        if db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
            db.execute("INSERT INTO user_profiles(user_id, phone, language, updated_at) VALUES (?, ?, ?, ?) "
                       "ON CONFLICT(user_id) DO NOTHING", (user_id, phone, language, now_iso()))

    from .translation import initialize_translation
    initialize_translation(db)
    from .customer import initialize_customer
    initialize_customer(db)


def profile(db, user_id, include_delivery=False):
    row = db.execute("SELECT phone, language FROM user_profiles WHERE user_id = ?", (user_id,)).fetchone()
    result = {"phone": row["phone"] if row else "", "language": row["language"] if row and row["language"] in LANGUAGES else "fr"}
    if include_delivery:
        from .customer import delivery_address, payment_method
        result["deliveryAddress"] = delivery_address(db, user_id)
        result["paymentMethod"] = payment_method(db, user_id)
    return result


def valid_phone(value):
    digits = re.sub(r"[\s().-]", "", value)
    if value and not re.fullmatch(r"\+?\d{10,15}", digits):
        raise APIError(400, "Le numéro de téléphone est invalide.")
    return value


def update_profile(handler, db, data):
    user = handler.user(db, {"client", "restaurant", "courier", "admin"})
    if not data or set(data) - {"phone", "language", "name", "deliveryAddress", "paymentMethod"}:
        raise APIError(400, "Les champs du profil sont invalides.")
    current = profile(db, user["id"])
    phone = valid_phone(text_field(data, "phone", 0, 30)) if "phone" in data else current["phone"]
    language = data.get("language", current["language"])
    if not isinstance(language, str) or language not in LANGUAGES:
        raise APIError(400, "Cette langue n’est pas proposée.")
    if "deliveryAddress" in data:
        from .customer import update_delivery_address
        update_delivery_address(db, user, data["deliveryAddress"])
    if "paymentMethod" in data:
        from .customer import update_payment_method
        update_payment_method(db, user, data["paymentMethod"])
    if "name" in data:
        db.execute("UPDATE users SET name = ? WHERE id = ?", (text_field(data, "name", 2, 100), user["id"]))
    db.execute("INSERT INTO user_profiles(user_id, phone, language, updated_at) VALUES (?, ?, ?, ?) "
               "ON CONFLICT(user_id) DO UPDATE SET phone = excluded.phone, language = excluded.language, updated_at = excluded.updated_at",
               (user["id"], phone, language, now_iso()))
    row = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    from .app import public_user
    return 200, {"user": {**public_user(row), **profile(db, user["id"], include_delivery=True)}}, None


def participants(db, order):
    """Les comptes rattachés à une commande, avec le rôle qu'ils y jouent."""
    people = {}
    client = db.execute("SELECT * FROM users WHERE id = ?", (order["customerId"],)).fetchone()
    if client:
        people["client"] = client
    restaurant = db.execute("SELECT * FROM users WHERE role = 'restaurant' AND restaurant_id = ? ORDER BY id LIMIT 1", (order["restaurantId"],)).fetchone()
    if restaurant:
        people["restaurant"] = restaurant
    if order.get("courierId"):
        courier = db.execute("SELECT * FROM users WHERE id = ?", (order["courierId"],)).fetchone()
        if courier:
            people["courier"] = courier
    return people


def membership(db, order, user):
    """Le rôle du demandeur dans ce fil, ou None s'il n'y participe pas."""
    if user["role"] == "admin":
        return "admin"
    if user["role"] == "client" and order["customerId"] == user["id"]:
        return "client"
    if user["role"] == "restaurant" and order["restaurantId"] == user["restaurant_id"]:
        return "restaurant"
    if user["role"] == "courier" and order.get("courierId") == user["id"]:
        return "courier"
    return None


def thread_open(order):
    """Accepted orders remain writable for thirty minutes after a terminal event."""
    if order["status"] in ACTIVE:
        return True
    if order["status"] not in {"delivered", "cancelled"}:
        return False
    if not any(event.get("status") == "accepted" for event in order.get("history", [])):
        return False
    try:
        # A later refund updates updatedAt, but must never reopen a conversation.
        # Keep the fallback only for legacy histories lacking their final event.
        terminal = next((event for event in reversed(order.get("history", []))
                         if event.get("status") == order["status"]), {})
        ended_at = terminal.get("date") or order.get("updatedAt")
        ended = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - ended).total_seconds()
        return 0 <= age < CLOSED_GRACE_SECONDS
    except (AttributeError, KeyError, TypeError, ValueError):
        return False


def contact_cards(db, order, viewer):
    """Qui le demandeur peut joindre, et par quel moyen, à cet instant précis."""
    people = participants(db, order)
    active = order["status"] in ACTIVE
    cards = []
    def card(role, user, label, reachable, note):
        details = profile(db, user["id"])
        # Delivery contact belongs to this order, not to later profile edits.
        name = order["customerName"] if role == "client" else user["name"]
        phone = order["phone"] if role == "client" else details["phone"]
        cards.append({"role": role, "label": label, "name": name,
                      "phone": phone if reachable and phone else "",
                      "language": details["language"], "note": note})
    for role, user in people.items():
        if role == viewer:
            continue
        if viewer == "client":
            if role == "restaurant":
                card(role, user, "Le restaurant", active, order["pickupAddress"] + ", " + order["pickupCity"])
            if role == "courier":
                card(role, user, "Votre livreur", order["status"] in {"ready", "picked_up"}, "Joignable jusqu’à la remise de votre commande.")
        elif viewer == "courier":
            if role == "client":
                card(role, user, "Le client", active, order["address"] + ", " + order["city"])
            if role == "restaurant":
                card(role, user, "Le restaurant", active, order["pickupAddress"] + ", " + order["pickupCity"])
        elif viewer == "restaurant":
            if role == "client":
                card(role, user, "Le client", active, order["city"])
            if role == "courier":
                card(role, user, "Le livreur", active, "Retrait en cours.")
        elif viewer == "admin":
            card(role, user, {"client": "Le client", "restaurant": "Le restaurant", "courier": "Le livreur"}[role],
                 True, "Supervision : coordonnées visibles pour l’assistance.")
    return cards


def message_payload(row, viewer_id):
    return {"id": row["id"], "mine": row["sender_id"] == viewer_id, "senderRole": row["sender_role"], "senderName": row["sender_name"],
            "body": row["body"], "language": row["language"], "phraseId": row["phrase_id"],
            "date": row["created_at"]}


def read_thread(handler, db, order_id):
    from .marketplace import order_row
    handler.ensure_write(db)
    user = handler.user(db, {"client", "restaurant", "courier", "admin"})
    _, order = order_row(db, order_id)
    viewer = membership(db, order, user)
    if not viewer:
        raise APIError(403, "Cette conversation ne vous concerne pas.")
    rows = db.execute("SELECT * FROM order_messages WHERE order_id = ? ORDER BY created_at, id", (order_id,)).fetchall()
    db.execute("INSERT INTO order_message_reads(order_id, user_id, last_read_at) VALUES (?, ?, ?) "
               "ON CONFLICT(order_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at",
               (order_id, user["id"], now_iso()))
    # The write lock keeps this selection identical to the messages returned
    # above. One insert avoids hundreds of remote round trips on long threads.
    db.execute("INSERT INTO order_message_receipts(message_id, user_id) "
               "SELECT id, ? FROM order_messages WHERE order_id = ? "
               "ON CONFLICT(message_id, user_id) DO NOTHING", (user["id"], order_id))
    return 200, {"messages": [message_payload(row, user["id"]) for row in rows],
                 "contacts": contact_cards(db, order, viewer),
                 "viewerRole": viewer, "viewerId": user["id"], "language": profile(db, user["id"])["language"],
                 "open": thread_open(order)}, None


def post_message(handler, db, order_id, data):
    from .marketplace import order_row
    user = handler.user(db, {"client", "restaurant", "courier", "admin"})
    _, order = order_row(db, order_id)
    viewer = membership(db, order, user)
    if not viewer:
        raise APIError(403, "Cette conversation ne vous concerne pas.")
    if set(data) - {"body", "phraseId", "requestId"} or ("body" in data and "phraseId" in data):
        raise APIError(400, "Envoyez un texte ou une réponse rapide, pas les deux.")
    phrase_id = data.get("phraseId", "")
    if not isinstance(phrase_id, str) or ("phraseId" in data and not phrase_id):
        raise APIError(400, "Ce message rapide n’existe pas.")
    request_id = data.get("requestId")
    request_hash = hashlib.sha256(json.dumps({key: value for key, value in data.items() if key != "requestId"}, sort_keys=True).encode()).hexdigest()
    if request_id is not None:
        try:
            if not isinstance(request_id, str) or str(uuid.UUID(request_id)) != request_id.lower():
                raise ValueError()
        except (ValueError, AttributeError):
            raise APIError(400, "L’identifiant du message est invalide.") from None
        request_id = request_id.lower()
        existing = db.execute("SELECT * FROM order_message_requests WHERE user_id = ? AND lower(request_id) = ?", (user["id"], request_id)).fetchone()
        if existing:
            if existing["order_id"] != order_id or existing["request_hash"] != request_hash:
                raise APIError(409, "Cet identifiant correspond déjà à un autre message.")
            message = db.execute("SELECT * FROM order_messages WHERE id = ?", (existing["message_id"],)).fetchone()
            return 200, {"message": message_payload(message, user["id"])}, None
    if not thread_open(order):
        raise APIError(409, "Cette conversation est close : la commande n’est pas en cours.")
    language = profile(db, user["id"])["language"]
    if phrase_id:
        if phrase_id not in PHRASES:
            raise APIError(400, "Ce message rapide n’existe pas.")
        body = PHRASES[phrase_id][language]
    else:
        body = text_field(data, "body", 1, 600)
    if db.execute("SELECT COUNT(*) FROM order_messages WHERE order_id = ?", (order_id,)).fetchone()[0] >= 200:
        raise APIError(409, "Cette conversation a atteint sa limite de messages.")
    message = {"id": uuid.uuid4().hex, "order_id": order_id, "sender_id": user["id"], "sender_role": viewer,
               "sender_name": user["name"], "body": body, "language": language,
               "phrase_id": phrase_id, "created_at": now_iso()}
    db.execute("INSERT INTO order_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (message["id"], order_id, user["id"], viewer, user["name"], body, language, phrase_id, message["created_at"]))
    if request_id is not None:
        db.execute("INSERT INTO order_message_requests VALUES (?, ?, ?, ?, ?)",
                   (user["id"], request_id, order_id, message["id"], request_hash))
    # Sending is not an acknowledgement of messages the sender has not read.
    return 201, {"message": message_payload(message, user["id"])}, None


def unread_counts(db, user):
    """Only count messages in orders the current account may still access."""
    scope, arguments = "", []
    if user["role"] == "client":
        scope, arguments = " AND o.customer_id = ?", [user["id"]]
    elif user["role"] == "restaurant":
        scope, arguments = " AND o.restaurant_id = ?", [user["restaurant_id"]]
    elif user["role"] == "courier":
        scope, arguments = " AND EXISTS (SELECT 1 FROM order_assignments a WHERE a.order_id = o.id AND a.courier_id = ?)", [user["id"]]
    elif user["role"] != "admin":
        return {}
    rows = db.execute("""SELECT m.order_id, COUNT(*) AS unread_count
        FROM order_messages m JOIN orders o ON o.id = m.order_id
        LEFT JOIN order_message_receipts r ON r.message_id = m.id AND r.user_id = ?
        WHERE m.sender_id <> ? AND r.message_id IS NULL""" + scope + " GROUP BY m.order_id",
        [user["id"], user["id"], *arguments]).fetchall()
    return {row["order_id"]: row["unread_count"] for row in rows}


def translate(handler, db, data):
    # The HTTP dispatcher calls this service before opening its normal DB scope.
    from .translation import translate_request
    return translate_request(handler, data)


def handle_messaging(handler, db, path, data):
    method = handler.command
    if path == "/api/profile" and method in {"GET", "PATCH"}:
        if method == "PATCH":
            return update_profile(handler, db, data)
        user = handler.user(db, {"client", "restaurant", "courier", "admin"})
        from .app import public_user
        return 200, {"user": {**public_user(user), **profile(db, user["id"], include_delivery=True)},
                     "languages": [{"code": code, "label": label} for code, label in LANGUAGES.items()]}, None
    if path == "/api/phrases" and method == "GET":
        return 200, {"phrases": [{"id": key, "labels": value} for key, value in PHRASES.items()]}, None
    match = re.fullmatch(r"/api/orders/([A-Za-z0-9-]+)/thread", path)
    if match and method == "GET":
        return read_thread(handler, db, match[1])
    match = re.fullmatch(r"/api/orders/([A-Za-z0-9-]+)/messages", path)
    if match and method == "POST":
        return post_message(handler, db, match[1], data)
    if path == "/api/translate" and method == "POST":
        return translate(handler, db, data)
    return None
