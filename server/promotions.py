"""Codes promotionnels : barème, contrôles et consommation.

Le rabais n'est jamais celui annoncé par le navigateur : il est recalculé ici à
partir du sous-total que le serveur a lui-même reconstitué depuis la carte.
"""
import re

from .app import APIError, now_iso

CODE = re.compile(r"[A-Z0-9][A-Z0-9-]{2,23}")
KINDS = {"percent", "amount", "delivery"}
# Codes de démonstration. Fenêtre large : la démo doit rester utilisable dans le temps.
SEED = [
    ("BIENVENUE", "20 % sur votre première commande", "percent", 20, 1500, None, "2026-01-01T00:00:00Z", "2030-12-31T23:59:59Z", 0, 1),
    ("LIVRAISON", "Livraison offerte dès 25 €", "delivery", 0, 2500, None, "2026-01-01T00:00:00Z", "2030-12-31T23:59:59Z", 0, 3),
    ("TIKAZ5", "5 € de remise chez Ti Kaz Kréol", "amount", 500, 2000, "ti-kreol", "2026-01-01T00:00:00Z", "2030-12-31T23:59:59Z", 200, 2),
]


def initialize_promotions(db):
    db.execute("""CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL,
        value INTEGER NOT NULL, minimum INTEGER NOT NULL DEFAULT 0,
        restaurant_id TEXT REFERENCES restaurants(id),
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
        max_uses INTEGER NOT NULL DEFAULT 0, per_customer INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS promo_uses (
        order_id TEXT PRIMARY KEY REFERENCES orders(id), code TEXT NOT NULL,
        customer_id TEXT NOT NULL REFERENCES users(id), used_at TEXT NOT NULL
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS promo_uses_code ON promo_uses(code, customer_id)")
    # Les codes existants ne sont jamais réécrits : un exploitant peut les avoir modifiés.
    for row in SEED:
        if db.execute("SELECT code FROM promo_codes WHERE code = ?", (row[0],)).fetchone():
            continue
        if row[5] and not db.execute("SELECT id FROM restaurants WHERE id = ?", (row[5],)).fetchone():
            continue
        db.execute("INSERT INTO promo_codes(code, label, kind, value, minimum, restaurant_id, starts_at, ends_at, max_uses, per_customer) "
                   "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO NOTHING", row)


def normalized_code(value, required=True):
    if value is None or value == "":
        if required:
            raise APIError(400, "Saisissez un code promo.")
        return None
    if not isinstance(value, str):
        raise APIError(400, "Le code promo est invalide.")
    code = value.strip().upper()
    if not CODE.fullmatch(code):
        raise APIError(400, "Un code promo comporte de 3 à 24 lettres, chiffres ou tirets.")
    return code


def discount_for(promo, subtotal, delivery):
    if promo["kind"] == "percent":
        return min(subtotal * promo["value"] // 100, subtotal)
    if promo["kind"] == "amount":
        return min(promo["value"], subtotal)
    return delivery


def conditions(promo):
    parts = []
    if promo["minimum"]:
        parts.append("dès %s" % money(promo["minimum"]))
    if promo["restaurant_id"]:
        parts.append("chez ce restaurant uniquement")
    if promo["per_customer"]:
        parts.append("%s utilisation%s par compte" % (promo["per_customer"], "s" if promo["per_customer"] > 1 else ""))
    return " · ".join(parts)


def money(cents):
    return ("%d,%02d €" % (cents // 100, cents % 100))


def evaluate(db, code, user, restaurant_id, subtotal, delivery, order_id=None):
    """Renvoie (promo, remise) ou lève l'erreur qui explique le refus au client."""
    promo = db.execute("SELECT * FROM promo_codes WHERE code = ?", (code,)).fetchone()
    if not promo or not promo["active"]:
        raise APIError(404, "Ce code promo n’existe pas ou n’est plus actif.")
    stamp = now_iso()
    if not promo["starts_at"] <= stamp <= promo["ends_at"]:
        raise APIError(409, "Ce code promo n’est pas valable en ce moment.")
    if promo["restaurant_id"] and promo["restaurant_id"] != restaurant_id:
        raise APIError(409, "Ce code promo ne s’applique pas à ce restaurant.")
    if subtotal < promo["minimum"]:
        raise APIError(409, "Ce code promo s’applique à partir de %s de commande." % money(promo["minimum"]))
    clause, args = ("", ()) if order_id is None else (" AND order_id <> ?", (order_id,))
    if promo["per_customer"]:
        used = db.execute("SELECT COUNT(*) FROM promo_uses WHERE code = ? AND customer_id = ?" + clause,
                          (code, user["id"]) + args).fetchone()[0]
        if used >= promo["per_customer"]:
            raise APIError(409, "Vous avez déjà utilisé ce code promo.")
    if promo["max_uses"]:
        total = db.execute("SELECT COUNT(*) FROM promo_uses WHERE code = ?" + clause, (code,) + args).fetchone()[0]
        if total >= promo["max_uses"]:
            raise APIError(409, "Ce code promo a atteint son nombre d’utilisations.")
    discount = discount_for(promo, subtotal, delivery)
    if discount <= 0:
        raise APIError(409, "Ce code promo n’apporte aucune remise sur ce panier.")
    return promo, discount


def public_promotions(db):
    """Les codes qu'un visiteur peut encore utiliser, sans compter les siens."""
    stamp = now_iso()
    offers = []
    for promo in db.execute("SELECT * FROM promo_codes WHERE active = 1 ORDER BY minimum, code"):
        if not promo["starts_at"] <= stamp <= promo["ends_at"]:
            continue
        if promo["max_uses"] and db.execute("SELECT COUNT(*) FROM promo_uses WHERE code = ?", (promo["code"],)).fetchone()[0] >= promo["max_uses"]:
            continue
        offers.append({"code": promo["code"], "label": promo["label"], "conditions": conditions(promo),
                       "restaurantId": promo["restaurant_id"], "minimum": promo["minimum"]})
    return offers


def record_use(db, order, user):
    if order.get("promoCode"):
        db.execute("INSERT INTO promo_uses(order_id, code, customer_id, used_at) VALUES (?, ?, ?, ?) "
                   "ON CONFLICT(order_id) DO NOTHING", (order["id"], order["promoCode"], user["id"], now_iso()))


def release_use(db, order_id):
    """Une commande annulée rend son code : le client peut le réutiliser."""
    db.execute("DELETE FROM promo_uses WHERE order_id = ?", (order_id,))
