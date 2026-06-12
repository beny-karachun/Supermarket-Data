#!/usr/bin/env bash
# Creates .venv and installs the ingestion pipeline's dependencies.
# Two-step install: il-supermarket-scraper pins lxml<6 (no Python 3.14 wheels),
# so we install its deps from requirements.txt (lxml 6 allowed) and the
# scraper itself without dependency resolution.
set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python3}"
[ -d .venv ] || "$PYTHON" -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install --no-deps il-supermarket-scraper==1.0.2
.venv/bin/python -c "from il_supermarket_scarper import ScarpingTask, ScraperFactory; print('scraper lib OK')"
