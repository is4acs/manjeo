"""Vercel Python Function entrypoint; the frontend stays on Vercel's CDN."""
from urllib.parse import parse_qs, urlencode, urlsplit

from server.app import AppConfig, AppState, Handler


class handler(Handler):
    application = AppState(config=AppConfig(cloud=True))

    def dispatch_api(self):
        parsed = urlsplit(self.path)
        route = parse_qs(parsed.query).get("route", [])
        if route:
            # vercel.json passes the captured API path explicitly after rewriting.
            if len(route) != 1 or not route[0] or any(char in route[0] for char in ("?", "#", "\\")):
                self.json_response(400, {"error": "Chemin API invalide."})
                return
            query = urlencode([(key, value) for key, values in parse_qs(parsed.query).items()
                               if key != "route" for value in values])
            # La réécriture Vercel fusionne la requête d'origine : la rendre au chemin API.
            self.path = "/api/" + route[0].lstrip("/") + ("?" + query if query else "")
        if not urlsplit(self.path).path.startswith("/api/"):
            self.json_response(404, {"error": "Cette ressource API n’existe pas."})
            return
        super().dispatch_api()
