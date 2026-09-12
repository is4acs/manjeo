#!/usr/bin/env bash
# Dependencies for a fresh or cached Codex Cloud checkout; no production secrets.
set -euo pipefail
MANJEO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MANJEO_ROOT"

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) throw new Error("Manjéo requires Node >=22.13");'
if command -v python3.12 >/dev/null 2>&1; then
  MANJEO_PYTHON=python3.12
else
  MANJEO_PYTHON=python3
fi
"$MANJEO_PYTHON" -c 'import sys; assert sys.version_info[:2] == (3, 12), "Select Python 3.12 in the Codex environment settings"'
"$MANJEO_PYTHON" -m venv .venv
.venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt
npm ci --no-audit --no-fund
echo "Manjéo ready. Run: bash scripts/codex-check.sh"
