#!/usr/bin/env bash
# Samsung Pulsar on this machine: prepares what is missing, then starts the platform.
# Nothing leaves the machine.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null; then
  echo "Python was not found. Install Python 3.11 or later, then run this file again." >&2
  exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Preparing Samsung Pulsar. This happens once and takes a few minutes."
  python3 -m venv .venv
  .venv/bin/python -m pip install --quiet --upgrade pip
  .venv/bin/python -m pip install --quiet -e .
  .venv/bin/python -m pulsar demo-data
fi

echo "Starting Samsung Pulsar on http://127.0.0.1:8765 (press Ctrl+C to stop)"
(sleep 4 && (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:8765 || open http://127.0.0.1:8765) >/dev/null 2>&1) &
exec .venv/bin/python -m pulsar
