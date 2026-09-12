"""Suggestions IGN pour les communes desservies, avec repli explicite de démo.

La saisie libre reste toujours possible. Ces suggestions ne constituent jamais
une validation obligatoire de l'adresse de livraison.
"""
import copy
import json
import math
import re
import threading
import time
import unicodedata
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

IGN_URL = "https://data.geopf.fr/geocodage/search"
CITY_CODES = {"Cayenne": "97302", "Rémire-Montjoly": "97309", "Matoury": "97307"}
CITIES_BY_CODE = {code: city for city, code in CITY_CODES.items()}
REQUEST_TIMEOUT = 2.5
MAX_RESPONSE_BYTES = 128_000
CACHE_TTL_SECONDS = 180
FAILURE_CACHE_TTL_SECONDS = 15
MAX_CACHE_ENTRIES = 128
FALLBACK_NOTE = "Service d’adresses momentanément indisponible. Suggestions de démonstration ; vous pouvez saisir votre adresse librement."
_cache = OrderedDict()
_cache_lock = threading.Lock()


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        # User input supplies only the query, never a host or a redirect target.
        return None


_opener = build_opener(_NoRedirects())

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


def _text(value, maximum=250, empty=False):
    if not isinstance(value, str) or len(value) > maximum or any(ord(char) < 32 for char in value):
        return None
    value = value.strip()
    return value if value or empty else None


def _parse_features(payload, expected_code):
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise ValueError("Invalid geocoding response")
    results = []
    for feature in payload["features"][:50]:
        if not isinstance(feature, dict) or not isinstance(feature.get("properties"), dict):
            continue
        properties = feature["properties"]
        code = properties.get("citycode")
        if not isinstance(code, str) or code != expected_code or code not in CITIES_BY_CODE:
            continue
        name = _text(properties.get("name"))
        number = _text(properties.get("housenumber", ""), maximum=20, empty=True)
        street = _text(properties.get("street", name if not number else None))
        if name is None or number is None or street is None:
            continue
        results.append({"label": name, "number": number, "street": street, "city": CITIES_BY_CODE[code]})
    return results


def _fetch_city(query, code):
    query_string = urlencode({"q": query, "citycode": code, "index": "address", "limit": 6})
    request = Request(IGN_URL + "?" + query_string,
                      headers={"Accept": "application/json", "User-Agent": "Manjeo-address-suggestions/1.0"})
    with _opener.open(request, timeout=REQUEST_TIMEOUT) as response:
        if response.status != 200:
            raise ValueError("Geocoding service unavailable")
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type not in {"application/json", "application/geo+json"}:
            raise ValueError("Invalid geocoding content type")
        body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError("Geocoding response too large")
    return _parse_features(json.loads(body.decode("utf-8")), code)


def _remember(key, response, ttl):
    with _cache_lock:
        now = time.monotonic()
        for old_key, (expires, _) in list(_cache.items()):
            if expires <= now:
                _cache.pop(old_key, None)
        _cache[key] = (now + ttl, copy.deepcopy(response))
        _cache.move_to_end(key)
        while len(_cache) > MAX_CACHE_ENTRIES:
            _cache.popitem(last=False)


def lookup(query, city=None, remote=True):
    """Return suggestions and their actual source; never block a manual address."""
    if not isinstance(query, str):
        return {"addresses": [], "source": "ign" if remote else "demo"}
    query = " ".join(query.split())[:120]
    if not query or any(ord(char) < 32 for char in query):
        return {"addresses": [], "source": "ign" if remote else "demo"}
    if city is not None and (not isinstance(city, str) or city not in CITY_CODES):
        return {"addresses": [], "source": "demo"}

    def local_result(note=None):
        result = {"addresses": [item for item in suggest(query, city) if city is None or item["city"] == city][:6],
                  "source": "demo"}
        if note:
            result["note"] = note
        return result

    if not remote:
        return local_result()
    if len(query) < 3:
        return {"addresses": [], "source": "ign"}
    key = (query.casefold(), city)
    with _cache_lock:
        cached = _cache.get(key)
        if cached and cached[0] > time.monotonic():
            _cache.move_to_end(key)
            return copy.deepcopy(cached[1])
    try:
        codes = [CITY_CODES[city]] if city else list(CITY_CODES.values())
        if len(codes) == 1:
            entries = _fetch_city(query, codes[0])
        else:
            # With no selected commune, keep the same bounded wall time as one
            # request and validate each response against its requested commune.
            with ThreadPoolExecutor(max_workers=3) as executor:
                groups = executor.map(lambda code: _fetch_city(query, code), codes)
                entries = [entry for group in groups for entry in group]
        seen, suggestions = set(), []
        for entry in entries:
            identity = (fold(entry["label"]), entry["city"])
            if identity not in seen:
                seen.add(identity)
                suggestions.append(entry)
        result = {"addresses": suggestions[:6], "source": "ign"}
        _remember(key, result, CACHE_TTL_SECONDS)
        return result
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, HTTPException, RecursionError):
        result = local_result(FALLBACK_NOTE)
        _remember(key, result, FAILURE_CACHE_TTL_SECONDS)
        return result


class AddressServiceUnavailable(Exception):
    """Provider failures never contain API keys, request URLs or submitted text."""


def _coordinates(latitude, longitude):
    # Geographic bounds reject nonsensical/inverted coordinates. The provider's
    # commune identifier is checked separately; this is not a delivery geofence.
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
           for value in (latitude, longitude)):
        return None
    if not (2 <= latitude <= 6 and -55 <= longitude <= -51):
        return None
    return {"latitude": latitude, "longitude": longitude}


def _verification_payload(url, parameters):
    request = Request(url + "?" + urlencode(parameters),
                      headers={"Accept": "application/json", "User-Agent": "Manjeo-address-geocoding/1.0"})
    try:
        with _opener.open(request, timeout=REQUEST_TIMEOUT) as response:
            if response.status != 200:
                raise AddressServiceUnavailable()
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type not in {"application/json", "application/geo+json"}:
                raise AddressServiceUnavailable()
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise AddressServiceUnavailable()
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise AddressServiceUnavailable()
        return payload
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, HTTPException, RecursionError):
        raise AddressServiceUnavailable() from None


def _ign_geocodes(address, city):
    payload = _verification_payload(IGN_URL, {"q": address, "citycode": CITY_CODES[city], "index": "address", "limit": 6})
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise AddressServiceUnavailable()
    candidates = []
    for feature in payload["features"][:50]:
        if not isinstance(feature, dict):
            continue
        properties, geometry = feature.get("properties"), feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            continue
        if properties.get("citycode") != CITY_CODES[city] or geometry.get("type") != "Point":
            continue
        location, score = geometry.get("coordinates"), properties.get("score")
        if not isinstance(location, list) or len(location) != 2 or _coordinates(location[1], location[0]) is None:
            continue
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not (0.5 <= score <= 1):
            continue
        name = _text(properties.get("name"))
        if not name or properties.get("type") not in {"housenumber", "street"}:
            continue
        candidates.append({"address": name, "city": city, **_coordinates(location[1], location[0]),
                           "provider": "ign", "precision": "house" if properties["type"] == "housenumber" else "street"})
    return candidates



def geocode(address, city):
    """Real IGN geocodes only; a caller must still confirm the result.

    Unlike lookup(), this never uses STREETS, including during an outage. The
    returned coordinates can be used with navigation services selected by users.
    """
    if not isinstance(address, str) or not isinstance(city, str) or city not in CITY_CODES:
        raise ValueError("Invalid address query")
    address = " ".join(address.split())
    candidates = _ign_geocodes(address, city)
    unique = {(item["address"].casefold(), item["latitude"], item["longitude"]): item for item in candidates}
    return {"candidates": list(unique.values())[:6], "source": "ign"}
