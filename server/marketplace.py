"""Menu publishing and delivery coordination shared by SQLite and PostgreSQL."""
import base64
import binascii
import copy
import hmac
import io
import json
import re
import secrets
import time
import uuid
import warnings
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from .app import APIError, CITIES, now_iso, text_field
from .messaging import initialize_messaging
from .promotions import initialize_promotions, release_use

ACCEPTANCE_SECONDS = 600
COURSE_SECONDS = 15 * 60
ACTIVE_STATUSES = {"accepted", "preparing", "ready", "picked_up"}
CLAIM_STATUSES = {"accepted", "preparing", "ready"}
TERMINAL_STATUSES = {"delivered", "cancelled"}
IDENTIFIER = re.compile(r"[A-Za-z0-9-]{1,100}")


def dumps(value):
    return json.dumps(value, ensure_ascii=False)


def integer(value, name, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise APIError(400, "Le champ « %s » doit être un entier entre %s et %s." % (name, minimum, maximum))
    return value


def boolean(value, name):
    if type(value) is not bool:
        raise APIError(400, "Le champ « %s » doit être vrai ou faux." % name)
    return value


def identifier(value, name="id"):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise APIError(400, "L’identifiant « %s » est invalide." % name)
    return value


def legacy_options(product):
    if not product.get("large"):
        return []
    return [
        {"id": "portion", "name": "Portion", "min": 1, "max": 1, "choices": [
            {"id": "classique", "name": "Classique", "price": 0},
            {"id": "gros-appetit", "name": "Gros appétit", "price": 200}]},
        {"id": "piment", "name": "Piment", "min": 1, "max": 1, "choices": [
            {"id": "sans-piment", "name": "Sans piment", "price": 0},
            {"id": "piment-a-part", "name": "Piment à part", "price": 0},
            {"id": "bien-releve", "name": "Bien relevé", "price": 0}]},
    ]


def initialize_marketplace(db):
    from .payments import initialize_payments
    initialize_payments(db)
    for statement in (
        """CREATE TABLE IF NOT EXISTS courier_profiles (
            user_id TEXT PRIMARY KEY REFERENCES users(id),
            online INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0,1))
        )""",
        """CREATE TABLE IF NOT EXISTS order_assignments (
            order_id TEXT PRIMARY KEY REFERENCES orders(id),
            courier_id TEXT REFERENCES users(id), state TEXT NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS assignments_courier ON order_assignments(courier_id, state)",
        """CREATE UNIQUE INDEX IF NOT EXISTS one_active_delivery_per_courier
            ON order_assignments(courier_id)
            WHERE courier_id IS NOT NULL AND state IN ('accepted','preparing','ready','picked_up')""",
        """CREATE TABLE IF NOT EXISTS delivery_attempts (
            order_id TEXT NOT NULL REFERENCES orders(id), attempted_at BIGINT NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS delivery_attempts_order ON delivery_attempts(order_id, attempted_at)",
        """CREATE TABLE IF NOT EXISTS menu_images (
            id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
            content_type TEXT NOT NULL, content_base64 TEXT NOT NULL, created_at TEXT NOT NULL
        )""",
    ):
        db.execute(statement)
    initialize_promotions(db)
    initialize_messaging(db)
    restaurants = {}
    for row in db.execute("SELECT * FROM restaurants ORDER BY sort_order, id").fetchall():
        restaurant = json.loads(row["data"])
        initial = copy.deepcopy(restaurant)
        restaurant.setdefault("menuVersion", 1)
        categories = []
        for product_row in db.execute("SELECT * FROM products WHERE restaurant_id = ? ORDER BY sort_order, id", (row["id"],)).fetchall():
            product = json.loads(product_row["data"])
            old_product = copy.deepcopy(product)
            product.setdefault("version", 1)
            product.setdefault("archived", False)
            product.setdefault("allergens", "")
            product.setdefault("optionGroups", legacy_options(product))
            if product.get("group") not in categories:
                categories.append(product.get("group", "La carte"))
            if product != old_product:
                db.execute("UPDATE products SET data = ? WHERE id = ?", (dumps(product), product_row["id"]))
        restaurant.setdefault("categories", categories)
        restaurant.setdefault("pickupAddress", "12 avenue de la Démo — adresse fictive")
        restaurant.setdefault("pickupCity", "Cayenne")
        if restaurant != initial:
            db.execute("UPDATE restaurants SET data = ? WHERE id = ?", (dumps(restaurant), row["id"]))
        restaurants[row["id"]] = restaurant
    for user in db.execute("SELECT id FROM users WHERE role = 'courier'").fetchall():
        db.execute("INSERT INTO courier_profiles(user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING", (user["id"],))
    # Existing order item and price snapshots are never reconstructed from menus.
    assigned_orders = {row["order_id"] for row in db.execute("SELECT order_id FROM order_assignments").fetchall()}
    for row in db.execute("SELECT * FROM orders").fetchall():
        order = json.loads(row["data"])
        initial = copy.deepcopy(order)
        order.setdefault("courierId", None)
        order.setdefault("courierName", None)
        restaurant = restaurants[row["restaurant_id"]]
        order.setdefault("pickupAddress", restaurant["pickupAddress"])
        order.setdefault("pickupCity", restaurant["pickupCity"])
        if order["status"] not in TERMINAL_STATUSES:
            order.setdefault("deliveryCode", "%04d" % secrets.randbelow(10_000))
        if order["status"] == "pending":
            if not order.get("acceptBy"):
                order["acceptBy"] = shifted(order["date"], ACCEPTANCE_SECONDS)
        else:
            # A completed acceptance deadline must not reappear on a cold start,
            # including on orders created before the deadline feature existed.
            order["acceptBy"] = None
        order.setdefault("eta", None)
        order.setdefault("promoCode", None)
        order.setdefault("promoLabel", "")
        order.setdefault("discount", 0)
        if order != initial:
            db.execute("UPDATE orders SET data = ? WHERE id = ?", (dumps(order), row["id"]))
        if order["id"] not in assigned_orders:
            db.execute("INSERT INTO order_assignments(order_id, courier_id, state) VALUES (?, ?, ?) ON CONFLICT(order_id) DO NOTHING", (order["id"], order["courierId"], order["status"]))
    db.execute("DELETE FROM delivery_attempts WHERE attempted_at <= ?", (int(time.time()) - 300,))


def shifted(stamp, seconds):
    """Décale un horodatage ISO sans dépendre du fuseau local."""
    moment = datetime.fromisoformat(stamp.replace("Z", "+00:00")) + timedelta(seconds=seconds)
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def acceptance_is_due(order, stamp):
    if order["status"] != "pending":
        return False
    deadline = order.get("acceptBy") or shifted(order["date"], ACCEPTANCE_SECONDS)
    try:
        deadline = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
        current = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if deadline.tzinfo is None or current.tzinfo is None:
            raise ValueError("An acceptance deadline must include its time zone")
        return deadline <= current
    except (TypeError, ValueError, AttributeError):
        # Legacy data without a usable deadline retains its original ten-minute
        # window. Never make a malformed optional field block every order feed.
        fallback = shifted(order["date"], ACCEPTANCE_SECONDS)
        return datetime.fromisoformat(fallback.replace("Z", "+00:00")) <= datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def expire_pending_orders(handler, db, stamp=None):
    """Le restaurant dispose de dix minutes pour accepter ; ensuite la commande tombe seule.

    Aucune tâche de fond n'existe sur cet hébergement : l'expiration est constatée
    à la première lecture ou écriture qui suit l'échéance.
    """
    stamp = stamp or now_iso()
    late = [row["order_id"] for row in db.execute(
        "SELECT order_id FROM order_assignments WHERE state = 'pending'").fetchall()]
    if not late:
        return
    expired = []
    for order_id in late:
        row = db.execute("SELECT data FROM orders WHERE id = ?", (order_id,)).fetchone()
        order = json.loads(row["data"]) if row else None
        if order and acceptance_is_due(order, stamp):
            expired.append(order)
    if not expired:
        return
    handler.ensure_write(db)
    for order in expired:
        # Un autre appel a pu accepter la commande entre la lecture et le verrou.
        current = json.loads(db.execute("SELECT data FROM orders WHERE id = ?", (order["id"],)).fetchone()["data"])
        if not acceptance_is_due(current, stamp):
            continue
        from .payments import cancel_payment
        cancel_payment(db, current)
        current["status"] = "cancelled"
        current["acceptBy"] = None
        current["updatedAt"] = stamp
        current["history"].append({"status": "cancelled", "date": current["updatedAt"],
                                   "label": "Annulation automatique — le restaurant n’a pas répondu dans les dix minutes"})
        db.execute("UPDATE orders SET data = ? WHERE id = ?", (dumps(current), current["id"]))
        db.execute("UPDATE order_assignments SET state = ? WHERE order_id = ?", ("cancelled", current["id"]))
        release_use(db, current["id"])


def projected_order(order, user):
    result = copy.deepcopy(order)
    if not (user['role'] == 'admin' or user['role'] == 'client' and user['id'] == order['customerId']
            or user['role'] == 'courier' and user['id'] == order.get('courierId')):
        result.pop('deliveryLocation', None)
    if user["role"] not in {"client", "admin"}:
        result.pop("deliveryCode", None)
        if order["status"] not in ACTIVE_STATUSES:
            result["phone"] = ""
    return result


def menu_payload(database, db, restaurant_row):
    restaurant = json.loads(restaurant_row["data"])
    return {"version": restaurant["menuVersion"], "categories": restaurant["categories"],
            "products": [database.product(row) for row in db.execute("SELECT * FROM products WHERE restaurant_id = ? ORDER BY sort_order, id", (restaurant_row["id"],))]}


def valid_image_url(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > 2048 or any(char.isspace() or ord(char) < 32 for char in value):
        raise APIError(400, "L’adresse de l’image est invalide.")
    if re.fullmatch(r"/images/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)", value, re.IGNORECASE) and ".." not in value:
        return value
    if re.fullmatch(r"/api/images/[a-f0-9]{32}", value):
        return value
    try:
        parsed = urlsplit(value)
        parsed.port  # Validate malformed/non-numeric ports before saving the URL.
        if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password and "\\" not in value:
            return value
    except ValueError:
        pass
    raise APIError(400, "Utilisez une image téléversée, une image existante ou une URL HTTPS.")


def validate_option_groups(raw):
    if not isinstance(raw, list) or len(raw) > 8:
        raise APIError(400, "Un produit peut proposer au maximum huit groupes d’options.")
    groups, group_ids = [], set()
    for group in raw:
        if not isinstance(group, dict):
            raise APIError(400, "Un groupe d’options est invalide.")
        group_id = identifier(group.get("id"), "groupe")
        if group_id in group_ids:
            raise APIError(400, "Deux groupes d’options ont le même identifiant.")
        group_ids.add(group_id)
        choices_raw = group.get("choices")
        if not isinstance(choices_raw, list) or not 1 <= len(choices_raw) <= 20:
            raise APIError(400, "Chaque groupe doit contenir entre un et vingt choix.")
        choices, choice_ids = [], set()
        for choice in choices_raw:
            if not isinstance(choice, dict):
                raise APIError(400, "Un choix est invalide.")
            choice_id = identifier(choice.get("id"), "choix")
            if choice_id in choice_ids:
                raise APIError(400, "Deux choix d’un groupe ont le même identifiant.")
            choice_ids.add(choice_id)
            choices.append({"id": choice_id, "name": text_field(choice, "name", 1, 100),
                            "price": integer(choice.get("price"), "supplément", 0, 100000)})
        maximum = integer(group.get("max"), "maximum de choix", 1, len(choices))
        minimum = integer(group.get("min"), "minimum de choix", 0, maximum)
        groups.append({"id": group_id, "name": text_field(group, "name", 1, 100),
                       "min": minimum, "max": maximum, "choices": choices})
    return groups


def validated_product(raw, categories):
    if not isinstance(raw, dict):
        raise APIError(400, "Un produit de la carte est invalide.")
    result = {"id": identifier(raw.get("id"), "produit"),
              "name": text_field(raw, "name", 1, 120),
              "description": text_field(raw, "description", 0, 1000),
              "allergens": text_field(raw, "allergens", 0, 500),
              "price": integer(raw.get("price"), "prix", 1, 100000),
              "group": text_field(raw, "group", 1, 80),
              "available": boolean(raw.get("available", True), "disponibilité"),
              "archived": boolean(raw.get("archived", False), "archivage"),
              "popular": boolean(raw.get("popular", False), "populaire"),
              "optionGroups": validate_option_groups(raw.get("optionGroups", []))}
    if not result["archived"] and result["group"] not in categories:
        raise APIError(400, "Chaque produit actif doit appartenir à une catégorie de la carte.")
    image = valid_image_url(raw.get("image"))
    if image:
        result["image"] = image
    return result


def comparable_product(product):
    # Normalize optional legacy fields without manufacturing an edit/version bump.
    return {"name": product["name"], "description": product.get("description", ""),
            "allergens": product.get("allergens", ""), "price": product["price"],
            "group": product["group"], "image": product.get("image") or None,
            "available": product.get("available", True), "archived": product.get("archived", False),
            "popular": product.get("popular", False), "optionGroups": product.get("optionGroups", [])}


def publish_menu(handler, db, restaurant_row, data):
    restaurant = json.loads(restaurant_row["data"])
    version = integer(data.get("version"), "version de carte", 1, 2**31 - 1)
    if version != restaurant["menuVersion"]:
        raise APIError(409, "La carte a changé dans un autre espace. Rechargez-la avant de publier votre brouillon.")
    categories = data.get("categories")
    if not isinstance(categories, list) or len(categories) > 30:
        raise APIError(400, "La carte peut contenir au maximum trente catégories.")
    categories = [text_field({"category": value}, "category", 1, 80) for value in categories]
    if len({category.casefold() for category in categories}) != len(categories):
        raise APIError(400, "Les catégories doivent avoir des noms distincts.")
    previous = {row["id"]: handler.state.database.product(row) for row in db.execute("SELECT * FROM products WHERE restaurant_id = ?", (restaurant_row["id"],))}
    # Omitted products remain archived in storage. Count the union, otherwise
    # repeated replacement batches can create a menu the editor cannot resubmit.
    # Existing oversized menus stay editable without deleting their history.
    maximum_products = max(100, len(previous))
    raw_products = data.get("products")
    if not isinstance(raw_products, list) or len(raw_products) > maximum_products:
        raise APIError(400, "La carte peut contenir au maximum cent produits.")
    products = [validated_product(raw, categories) for raw in raw_products]
    if len({product["id"] for product in products}) != len(products):
        raise APIError(400, "Chaque produit doit avoir un identifiant distinct.")
    if len(set(previous) | {product["id"] for product in products}) > maximum_products:
        raise APIError(400, "La carte peut contenir au maximum cent produits.")
    for product in products:
        row = db.execute("SELECT restaurant_id FROM products WHERE id = ?", (product["id"],)).fetchone()
        if row and row["restaurant_id"] != restaurant_row["id"]:
            raise APIError(400, "Un identifiant de produit est déjà utilisé par un autre restaurant.")
        if product.get("image", "").startswith("/api/images/") and not db.execute("SELECT id FROM menu_images WHERE id = ?", (product["image"].rsplit("/", 1)[1],)).fetchone():
            raise APIError(400, "Une image téléversée de la carte est introuvable.")
        old = previous.get(product["id"])
        product["version"] = old["version"] + int(comparable_product(old) != comparable_product(product)) if old else 1
    # Every field in every product is validated before the first mutation.
    for position, product in enumerate(products):
        persisted = {key: value for key, value in product.items() if key != "available"}
        db.execute("""INSERT INTO products(id, restaurant_id, data, available, sort_order)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
            data = excluded.data, available = excluded.available, sort_order = excluded.sort_order""",
                   (product["id"], restaurant_row["id"], dumps(persisted), int(product["available"]), position))
    submitted = {product["id"] for product in products}
    for product_id, product in previous.items():
        if product_id not in submitted and not product["archived"]:
            product["archived"] = True
            product["version"] += 1
            persisted = {key: value for key, value in product.items() if key != "available"}
            db.execute("UPDATE products SET data = ? WHERE id = ?", (dumps(persisted), product_id))
    restaurant["categories"] = categories
    restaurant["menuVersion"] += 1
    db.execute("UPDATE restaurants SET data = ? WHERE id = ?", (dumps(restaurant), restaurant_row["id"]))
    row = db.execute("SELECT * FROM restaurants WHERE id = ?", (restaurant_row["id"],)).fetchone()
    return 200, {"menu": menu_payload(handler.state.database, db, row)}, None


def update_restaurant(handler, db, row, data):
    allowed = {"acceptingOrders", "name", "description", "minutes", "pickupAddress", "pickupCity"}
    if not data or set(data) - allowed:
        raise APIError(400, "Les paramètres de l’établissement sont invalides.")
    restaurant = json.loads(row["data"])
    for field, minimum, maximum in (("name", 1, 120), ("description", 0, 500), ("pickupAddress", 5, 250), ("pickupCity", 1, 50)):
        if field in data:
            restaurant[field] = text_field(data, field, minimum, maximum)
    if restaurant["pickupCity"] not in CITIES:
        raise APIError(400, "La ville de retrait n’est pas desservie.")
    if "minutes" in data:
        restaurant["minutes"] = integer(data["minutes"], "temps de préparation", 5, 180)
    accepting = boolean(data["acceptingOrders"], "ouverture") if "acceptingOrders" in data else bool(row["accepting_orders"])
    db.execute("UPDATE restaurants SET data = ?, accepting_orders = ? WHERE id = ?", (dumps(restaurant), int(accepting), row["id"]))
    result = handler.state.database.restaurant(db, db.execute("SELECT * FROM restaurants WHERE id = ?", (row["id"],)).fetchone())
    return 200, {"restaurant": result}, None


def selected_price(product, raw_selections):
    if not isinstance(raw_selections, list) or len(raw_selections) > 8:
        raise APIError(400, "Les options sélectionnées sont invalides.")
    selections = {}
    groups = {group["id"]: group for group in product["optionGroups"]}
    for selection in raw_selections:
        if not isinstance(selection, dict):
            raise APIError(400, "Une sélection d’option est invalide.")
        group_id = identifier(selection.get("groupId"), "groupe d’options")
        choices = selection.get("choiceIds")
        if group_id not in groups or group_id in selections or not isinstance(choices, list) or len(choices) > 20:
            raise APIError(400, "Une option est étrangère au produit ou présente plusieurs fois.")
        choices = [identifier(choice, "choix") for choice in choices]
        if len(set(choices)) != len(choices):
            raise APIError(400, "Un même choix ne peut pas être sélectionné plusieurs fois.")
        selections[group_id] = choices
    price, labels, normalized = product["price"], [], []
    for group in product["optionGroups"]:
        selected = selections.get(group["id"], [])
        available = {choice["id"]: choice for choice in group["choices"]}
        if any(choice not in available for choice in selected) or not group["min"] <= len(selected) <= group["max"]:
            raise APIError(400, "Respectez les choix proposés pour « %s »." % group["name"])
        selected = sorted(selected)
        for choice_id in selected:
            price += available[choice_id]["price"]
            labels.append(group["name"] + " : " + available[choice_id]["name"])
        if selected:
            normalized.append({"groupId": group["id"], "choiceIds": selected})
    return price, " · ".join(labels) or "Sans option", normalized


def upload_image(handler, db, restaurant_row, data):
    data_url = data.get("dataUrl")
    if not isinstance(data_url, str):
        raise APIError(400, "Une image est requise.")
    match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", data_url)
    if not match:
        raise APIError(400, "Utilisez une image JPEG, PNG ou WebP.")
    try:
        raw = base64.b64decode(match[2], validate=True)
    except (ValueError, binascii.Error):
        raise APIError(400, "L’image est invalide.") from None
    if not 0 < len(raw) <= 1024 * 1024:
        raise APIError(413, "L’image ne doit pas dépasser 1 Mo.")
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError:
        raise APIError(503, "Le service d’images est momentanément indisponible.") from None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw), formats=("JPEG", "PNG", "WEBP")) as candidate:
                if candidate.format != {"jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}[match[1]] or candidate.width * candidate.height > 16_000_000:
                    raise ValueError()
                candidate.verify()
            with Image.open(io.BytesIO(raw), formats=("JPEG", "PNG", "WEBP")) as original:
                picture = ImageOps.exif_transpose(original)
                picture.thumbnail((1600, 1600))
                rgba = picture.convert("RGBA")
                image = Image.new("RGB", rgba.size, "white")
                image.paste(rgba, mask=rgba.getchannel("A"))
                buffer = io.BytesIO()
                image.save(buffer, format="JPEG", quality=85, optimize=True)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise APIError(400, "Le fichier n’est pas une image valide ou ses dimensions sont trop grandes.") from None
    image_id = uuid.uuid4().hex
    db.execute("INSERT INTO menu_images VALUES (?, ?, ?, ?, ?)", (image_id, restaurant_row["id"], "image/jpeg", base64.b64encode(buffer.getvalue()).decode("ascii"), now_iso()))
    return 201, {"url": "/api/images/" + image_id}, None


def courier_profile(db, user):
    row = db.execute("SELECT online FROM courier_profiles WHERE user_id = ?", (user["id"],)).fetchone()
    active = db.execute("SELECT order_id FROM order_assignments WHERE courier_id = ? AND state IN ('accepted','preparing','ready','picked_up')", (user["id"],)).fetchone()
    return {"id": user["id"], "name": user["name"], "email": user["email"],
            "online": bool(row["online"]) if row else False, "activeOrderId": active["order_id"] if active else None}


def order_row(db, order_id):
    row = db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not row:
        raise APIError(404, "Commande introuvable.")
    return row, json.loads(row["data"])


def save_order(db, order, user, label=None, stamp=None):
    order["updatedAt"] = stamp or now_iso()
    event = {"status": order["status"], "date": order["updatedAt"], "actorName": user["name"]}
    if label:
        event["label"] = label
    order["history"].append(event)
    db.execute("UPDATE orders SET data = ? WHERE id = ?", (dumps(order), order["id"]))
    db.execute("UPDATE order_assignments SET courier_id = ?, state = ? WHERE order_id = ?", (order["courierId"], order["status"], order["id"]))


def require_free_courier(db, user, order_id):
    profile = courier_profile(db, user)
    if not profile["online"]:
        raise APIError(409, "Le livreur doit être en ligne pour prendre une mission.")
    if profile["activeOrderId"] and profile["activeOrderId"] != order_id:
        raise APIError(409, "Ce livreur a déjà une mission en cours.")


def assign_order(handler, db, order_id, action, data):
    user = handler.user(db, {"admin"} if action == "assign" else {"courier"})
    _, order = order_row(db, order_id)
    if action == "claim" and order["courierId"] == user["id"] and order["status"] in ACTIVE_STATUSES:
        return 200, {"order": projected_order(order, user)}, None
    if order["status"] not in CLAIM_STATUSES:
        raise APIError(409, "L’affectation est possible après acceptation et avant le retrait.")
    reason = text_field(data, "reason", 3, 250) if action != "claim" else None
    if action == "claim":
        if order["courierId"]:
            raise APIError(409, "Un livreur a déjà pris cette mission.")
        courier = user
    elif action == "release":
        if order["courierId"] != user["id"]:
            raise APIError(403, "Vous ne pouvez libérer que votre mission.")
        courier = None
    else:
        courier_id = data.get("courierId")
        if "courierId" not in data:
            raise APIError(400, "Choisissez un livreur ou libérez la mission.")
        courier = None
        if courier_id is not None:
            identifier(courier_id, "livreur")
            courier = db.execute("SELECT * FROM users WHERE id = ? AND role = 'courier'", (courier_id,)).fetchone()
            if not courier:
                raise APIError(400, "Ce compte n’est pas un livreur.")
    if courier:
        require_free_courier(db, courier, order_id)
    previous_name = order["courierName"]
    order["courierId"] = courier["id"] if courier else None
    order["courierName"] = courier["name"] if courier else None
    label = ("Mission confiée à " + courier["name"]) if courier else ("Mission libérée" + (" par " + previous_name if previous_name else ""))
    if reason:
        label += " — " + reason
    save_order(db, order, user, label)
    # A released mission has left the courier's scope; do not return its private
    # address/phone merely as a side effect of releasing it.
    if action == "release":
        return 200, {"ok": True}, None
    return 200, {"order": projected_order(order, user)}, None


def transition_order(handler, db, order_id, data):
    user = handler.user(db, {"client", "restaurant", "courier", "admin"})
    row, order = order_row(db, order_id)
    role, current, target = user["role"], order["status"], data.get("status")
    if not isinstance(target, str):
        raise APIError(400, "Le statut de la commande est invalide.")
    if role == "client" and row["customer_id"] != user["id"]:
        raise APIError(403, "Vous ne pouvez modifier que votre commande.")
    if role == "restaurant" and row["restaurant_id"] != user["restaurant_id"]:
        raise APIError(403, "Vous ne pouvez traiter que les commandes de votre restaurant.")
    if role == "courier" and order["courierId"] != user["id"]:
        raise APIError(403, "Cette mission ne vous est pas affectée.")
    if current in TERMINAL_STATUSES:
        raise APIError(409, "Cette commande est terminée et ne peut plus être modifiée.")
    label = None
    if current == 'awaiting_payment' and role not in {'client', 'admin'}:
        raise APIError(403, 'Cette commande attend la confirmation de son paiement.')
    if target == "cancelled":
        if role == "courier" or role == "client" and current not in {"pending", "awaiting_payment"} or current == "picked_up":
            raise APIError(409, "Cette commande ne peut plus être annulée depuis votre espace.")
        label = "Annulation — " + text_field(data, "reason", 3, 250)
    elif role in {"restaurant", "admin"}:
        if target in {"picked_up", "delivered"}:
            raise APIError(403, "Seul le livreur affecté peut retirer et livrer la commande.")
        if (current, target) not in {("pending", "accepted"), ("accepted", "preparing"), ("preparing", "ready")}:
            raise APIError(409, "Ce changement de statut cuisine n’est pas autorisé.")
    elif role == "courier":
        if (current, target) not in {("ready", "picked_up"), ("picked_up", "delivered")}:
            raise APIError(409, "Le retrait exige une commande prête, puis la remise au client.")
        if target == "delivered":
            stamp = int(time.time())
            db.execute("DELETE FROM delivery_attempts WHERE attempted_at <= ?", (stamp - 300,))
            count = db.execute("SELECT COUNT(*) FROM delivery_attempts WHERE order_id = ?", (order_id,)).fetchone()[0]
            if count >= 5:
                return 429, {"error": "Trop de codes incorrects. Réessayez dans cinq minutes."}, None
            code = data.get("deliveryCode")
            if not isinstance(code, str) or not re.fullmatch(r"[0-9]{4}", code) or not hmac.compare_digest(code, order.get("deliveryCode", "")):
                db.execute("INSERT INTO delivery_attempts VALUES (?, ?)", (order_id, stamp))
                # Return normally so this failed attempt commits across cold starts.
                return 400, {"error": "Le code de remise est incorrect. Demandez les quatre chiffres au client."}, None
            db.execute("DELETE FROM delivery_attempts WHERE order_id = ?", (order_id,))
    else:
        raise APIError(403, "Votre compte ne permet pas ce changement de statut.")
    transition_stamp = now_iso()
    if target == "accepted":
        # The deadline may pass after dispatch's initial expiry check. Return
        # normally so this cancellation and promo refund survive the savepoint.
        if acceptance_is_due(order, transition_stamp):
            expire_pending_orders(handler, db, stamp=transition_stamp)
            return 409, {"error": "Cette commande a expiré : le délai d’acceptation de dix minutes est dépassé."}, None
        # L'estimation n'est posée qu'une fois, à l'acceptation : préparation + course.
        row = db.execute("SELECT data FROM restaurants WHERE id = ?", (order["restaurantId"],)).fetchone()
        minutes = json.loads(row["data"]).get("minutes", 25) if row else 25
        order["eta"] = shifted(transition_stamp, minutes * 60 + COURSE_SECONDS)
        order["acceptBy"] = None
    elif target == "cancelled":
        from .payments import cancel_payment
        cancel_payment(db, order)
        order["acceptBy"] = None
    order["status"] = target
    save_order(db, order, user, label, stamp=transition_stamp)
    if target == "cancelled":
        release_use(db, order["id"])
    return 200, {"order": projected_order(order, user)}, None


def check_promotion(handler, db, data):
    """Aperçu de la remise avant commande ; le total qui fait foi est recalculé à la création."""
    from .promotions import conditions, evaluate, normalized_code
    user = handler.user(db, {"client"})
    code = normalized_code(data.get("code"))
    restaurant_id = identifier(data.get("restaurantId"), "restaurant")
    row = db.execute("SELECT * FROM restaurants WHERE id = ?", (restaurant_id,)).fetchone()
    if not row:
        raise APIError(404, "Restaurant introuvable.")
    restaurant = json.loads(row["data"])
    city = text_field(data, "city", 1, 50)
    if city not in CITIES:
        raise APIError(400, "Cette ville n’est pas desservie dans la démo.")
    subtotal = integer(data.get("subtotal"), "sous-total", 1, 10_000_000)
    delivery = restaurant["delivery"] + (0 if city == "Cayenne" else 100)
    promo, discount = evaluate(db, code, user, restaurant_id, subtotal, delivery)
    return 200, {"promotion": {"code": promo["code"], "label": promo["label"],
                               "conditions": conditions(promo), "discount": discount}}, None


def delivery_offer(order):
    return {key: order[key] for key in ("id", "restaurantId", "restaurant", "pickupAddress", "pickupCity", "city", "count", "status", "delivery", "date")}


def deliveries(handler, db):
    from .messaging import unread_counts
    user = handler.user(db, {"courier"})
    profile = courier_profile(db, user)
    assigned = [projected_order(json.loads(row["data"]), user) for row in db.execute("SELECT orders.data FROM orders JOIN order_assignments ON orders.id = order_assignments.order_id WHERE courier_id = ? ORDER BY orders.created_at DESC, orders.id DESC", (user["id"],))]
    offers = []
    if profile["online"] and not profile["activeOrderId"]:
        for row in db.execute("SELECT orders.data FROM orders JOIN order_assignments ON orders.id = order_assignments.order_id WHERE courier_id IS NULL AND state IN ('accepted','preparing','ready') ORDER BY orders.created_at, orders.id"):
            offers.append(delivery_offer(json.loads(row["data"])))
    return 200, {"available": offers, "assigned": assigned, "profile": profile, "unread": unread_counts(db, user)}, None


def handle_marketplace(handler, db, path, data):
    """Return None only when an endpoint belongs to the base API."""
    method = handler.command
    match = re.fullmatch(r"/api/restaurants/([A-Za-z0-9-]+)/menu", path)
    if match and method in {"GET", "PATCH"}:
        row = handler.managed_restaurant(db, match[1])
        return (200, {"menu": menu_payload(handler.state.database, db, row)}, None) if method == "GET" else publish_menu(handler, db, row, data)
    match = re.fullmatch(r"/api/restaurants/([A-Za-z0-9-]+)/images", path)
    if match and method == "POST":
        return upload_image(handler, db, handler.managed_restaurant(db, match[1]), data)
    if method == "GET" and path == "/api/promotions":
        from .promotions import public_promotions
        return 200, {"promotions": public_promotions(db)}, None
    if method == "POST" and path == "/api/promotions/check":
        return check_promotion(handler, db, data)
    if method == "GET" and path == "/api/deliveries":
        return deliveries(handler, db)
    if path == "/api/courier/profile" and method == "PATCH":
        user = handler.user(db, {"courier"})
        online = boolean(data.get("online"), "disponibilité")
        db.execute("INSERT INTO courier_profiles(user_id, online) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET online = excluded.online", (user["id"], int(online)))
        return 200, {"profile": courier_profile(db, user)}, None
    if method == "GET" and path == "/api/couriers":
        handler.user(db, {"admin"})
        return 200, {"couriers": [courier_profile(db, row) for row in db.execute("SELECT * FROM users WHERE role = 'courier' ORDER BY name, id")]}, None
    match = re.fullmatch(r"/api/orders/([A-Za-z0-9-]+)/(claim|release|assign)", path)
    if match and method == "POST":
        return assign_order(handler, db, match[1], match[2], data)
    match = re.fullmatch(r"/api/orders/([A-Za-z0-9-]+)", path)
    if match and method == "PATCH":
        return transition_order(handler, db, match[1], data)
    match = re.fullmatch(r"/api/restaurants/([A-Za-z0-9-]+)", path)
    if match and method == "PATCH":
        return update_restaurant(handler, db, handler.managed_restaurant(db, match[1]), data)
    return None
