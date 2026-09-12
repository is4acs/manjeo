"""Répertoire d'adresses de démonstration pour les trois communes desservies.

Liste fixe, hors ligne et déterministe : elle sert à faire fonctionner la saisie
assistée sans clé ni appel réseau. En production, brancher un vrai géocodeur
(Base Adresse Nationale, https://api-adresse.data.gouv.fr) à la place de ce module ;
l'interface consomme déjà la même forme de réponse.
"""
import re
import unicodedata

# Voies réellement présentes dans ces communes ; les numéros, eux, sont saisis par le visiteur.
STREETS = {
    "Cayenne": [
        "Avenue du Général de Gaulle", "Avenue Pasteur", "Avenue Léopold Héder",
        "Avenue d’Estrées", "Avenue Voltaire", "Boulevard Jubelin",
        "Boulevard de la République", "Place des Palmistes", "Rue Lallouette",
        "Rue Christophe Colomb", "Rue Justin Catayée", "Rue Lieutenant Brassé",
        "Rue Madame Payé", "Rue François Arago", "Rue Schoelcher",
        "Route de Baduel", "Route de Montabo", "Route de la Madeleine",
        "Chemin Saint-Antoine", "Avenue Monnerville",
    ],
    "Rémire-Montjoly": [
        "Route de Rémire", "Route des Plages", "Route de Montjoly",
        "Avenue Léon Gontran Damas", "Chemin Poupon", "Chemin de la Chaumière",
        "Rue des Flamboyants", "Rue du Vieux Bourg", "Allée des Cocotiers",
        "Lotissement Cogneau-Larivot",
    ],
    "Matoury": [
        "Route de Cayenne", "Route de la Levée", "Avenue Louis Bertrand",
        "Chemin de Balata", "Chemin du Stade", "Rue des Orchidées",
        "Rue du Bourg", "Allée des Manguiers", "Route de Terca",
        "Lotissement Cogneau-Lamirande",
    ],
}
NUMBER = re.compile(r"^\s*(\d{1,4})\s*(bis|ter|b|t)?\b[\s,]*", re.IGNORECASE)
SUFFIXES = {"b": "bis", "t": "ter"}


def fold(value):
    stripped = unicodedata.normalize("NFD", value.replace("’", "'"))
    return "".join(char for char in stripped if unicodedata.category(char) != "Mn").lower()


def split_number(query):
    """Sépare « 7 bis rue lall » en (« 7 bis », « rue lall »)."""
    match = NUMBER.match(query)
    if not match:
        return "", query.strip()
    suffix = (match[2] or "").lower()
    number = match[1] + (" " + SUFFIXES.get(suffix, suffix) if suffix else "")
    return number, query[match.end():].strip()


def score(street, city, tokens):
    """Plus le score est bas, meilleure est la proposition ; None écarte la voie."""
    haystack = fold(street)
    words = haystack.split()
    total = 0
    for token in tokens:
        if haystack.startswith(token):
            total += 0
        elif any(word.startswith(token) for word in words):
            total += 1
        elif token in haystack:
            total += 2
        elif token in fold(city):
            total += 3
        else:
            return None
    return total


def suggest(query, city=None, limit=6):
    if not isinstance(query, str):
        return []
    number, rest = split_number(query.strip()[:120])
    tokens = [token for token in fold(rest).split() if token]
    if not tokens and not number:
        return []
    communes = [city] if city in STREETS else list(STREETS)
    if city in STREETS:
        communes += [name for name in STREETS if name != city]
    results = []
    for rank, commune in enumerate(communes):
        for position, street in enumerate(STREETS[commune]):
            value = score(street, commune, tokens) if tokens else 0
            if value is None:
                continue
            results.append((value, rank, position, street, commune))
    results.sort()
    return [{"label": (number + " " + street).strip(), "number": number,
             "street": street, "city": commune}
            for _, _, _, street, commune in results[:max(1, min(limit, 10))]]
