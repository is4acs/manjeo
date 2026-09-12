#!/usr/bin/env python3
"""Build a fresh source snapshot outside cloud-synced folders.

Only application source and public assets are copied. SQLite data, sessions,
environment files, Git metadata and server files never enter the snapshot.
"""
import argparse
import concurrent.futures
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIRECTORIES = ("app", "components", "lib", "public", "vendor")
SOURCE_FILES = ("index.html", "postcss.config.mjs", "vite.local.config.ts", "package.json", "tsconfig.json")


def cache_root():
    if sys.platform == "darwin":
        return Path.home() / "Library/Caches/manjeo-build"
    return Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "manjeo-build"


def install_dependencies(cache, node, lock_data):
    package_path = ROOT / "package.json"
    cached_lock = cache / "package-lock.json"
    ready = (cache / "node_modules/typescript/bin/tsc").is_file() and (cache / "node_modules/vite/bin/vite.js").is_file()
    matching = cached_lock.is_file() and cached_lock.read_bytes() == lock_data
    (cache / "package.json").write_bytes(package_path.read_bytes())
    cached_lock.write_bytes(lock_data)
    if not ready or not matching:
        npm = shutil.which("npm")
        if not npm:
            raise RuntimeError("npm est introuvable. Installez Node.js avec npm.")
        print("Installation des dépendances dans le cache local…", flush=True)
        subprocess.run([npm, "ci", "--no-audit", "--no-fund"], cwd=cache, check=True)


def copy_sources(snapshot):
    files = [ROOT / name for name in SOURCE_FILES]
    for name in SOURCE_DIRECTORIES:
        files.extend(path for path in (ROOT / name).rglob("*") if path.is_file())

    def copy(path):
        target = snapshot / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        # Reading in Python also materializes an iCloud placeholder when necessary.
        target.write_bytes(path.read_bytes())

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
        list(executor.map(copy, files))


def publish(output, cache):
    destination = cache / "workspace/dist"
    destination.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    if destination.exists():
        backup = cache / "previous-builds" / stamp
        backup.parent.mkdir(parents=True, exist_ok=True)
        destination.rename(backup)
    output.rename(destination)

    project_dist = ROOT / "dist"
    if project_dist.is_symlink() and project_dist.resolve() == destination.resolve():
        return
    if project_dist.exists() or project_dist.is_symlink():
        backup = ROOT / ".sites-runtime/build-backups" / ("dist-" + stamp)
        backup.parent.mkdir(parents=True, exist_ok=True)
        project_dist.rename(backup)
    project_dist.symlink_to(destination, target_is_directory=True)


def main():
    parser = argparse.ArgumentParser(description="Compile Manjéo depuis un cache local, puis actualise dist.")
    parser.parse_args()
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js est introuvable. Installez Node.js 22.13 ou ultérieur.")
    lock_data = (ROOT / "package-lock.json").read_bytes()
    cache = cache_root() / hashlib.sha256(lock_data).hexdigest()[:12]
    cache.mkdir(parents=True, exist_ok=True)
    install_dependencies(cache, node, lock_data)
    with tempfile.TemporaryDirectory(prefix="source-", dir=cache) as directory:
        snapshot = Path(directory)
        print("Préparation des sources dans le cache local…", flush=True)
        copy_sources(snapshot)
        (snapshot / "node_modules").symlink_to(cache / "node_modules", target_is_directory=True)
        subprocess.run([node, str(snapshot / "node_modules/typescript/bin/tsc"), "--noEmit"], cwd=snapshot, check=True)
        subprocess.run([node, str(snapshot / "node_modules/vite/bin/vite.js"), "build", "--config", "vite.local.config.ts"], cwd=snapshot, check=True)
        publish(snapshot / "dist", cache)
    print("Compilation terminée. Lancez npm start, puis ouvrez http://127.0.0.1:5173/", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print("Échec de la compilation : %s" % error, file=sys.stderr)
        sys.exit(1)
