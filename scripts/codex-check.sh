#!/usr/bin/env bash
# Run the self-contained suite without a connection to the online database.
set -euo pipefail
MANJEO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MANJEO_ROOT"
if [ ! -x .venv/bin/python ]; then
  echo "Run bash scripts/codex-setup.sh first." >&2
  exit 1
fi
env -u DATABASE_URL -u POSTGRES_URL -u MANJEO_TEST_DATABASE_URL -u VERCEL \
  PATH="$MANJEO_ROOT/.venv/bin:$PATH" npm test
npm run build:vercel
