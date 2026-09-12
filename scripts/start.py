"""Serve the built local app and its API in one Python process."""

import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]


def main():
    if not (ROOT / "dist" / "index.html").is_file():
        print("Les fichiers du site manquent. Lancez d'abord : npm run build", file=sys.stderr)
        return 1
    os.chdir(ROOT)
    os.execv(sys.executable, [sys.executable, "server/app.py", "--port", "5173"])


if __name__ == "__main__":
    sys.exit(main())
