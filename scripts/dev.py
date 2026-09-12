"""Run the local Python API and Vite together; stop both on Ctrl-C or failure."""

import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]


def port_is_busy(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return True
    except OSError:
        return False


def main():
    vite = ROOT / "node_modules" / "vite" / "bin" / "vite.js"
    node = os.environ.get("npm_node_execpath") or os.environ.get("NODE") or shutil.which("node")
    if not node or not vite.is_file():
        print("Node.js et les dépendances sont requis. Lancez d'abord : npm install", file=sys.stderr)
        return 1
    for port in (5173, 5174):
        if port_is_busy(port):
            print(
                f"Le port {port} est déjà utilisé. Arrêtez le serveur précédent avant de relancer npm run dev.",
                file=sys.stderr,
            )
            return 1

    children = []
    stopping = False

    def request_stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    try:
        api = subprocess.Popen(
            [sys.executable, "-u", "server/app.py", "--port", "5174"],
            cwd=ROOT,
            start_new_session=True,
        )
        children.append(api)
        deadline = time.monotonic() + 20
        while not port_is_busy(5174):
            if stopping:
                return 0
            if api.poll() is not None:
                return api.returncode or 1
            if time.monotonic() >= deadline:
                print("L’API ne répond pas sur le port 5174. Consultez son erreur ci-dessus.", file=sys.stderr)
                return 1
            time.sleep(0.1)

        print("manjéo : http://127.0.0.1:5173/ — Ctrl-C arrête les deux serveurs.", flush=True)
        children.append(subprocess.Popen(
            [node, str(vite), "--config", "vite.local.config.ts"],
            cwd=ROOT,
            start_new_session=True,
        ))
        while not stopping:
            for child in children:
                if child.poll() is not None:
                    return child.returncode or 1
            time.sleep(0.2)
        return 0
    finally:
        # Separate process groups also cover any helper processes started by Vite.
        for child in children:
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()


if __name__ == "__main__":
    sys.exit(main())
