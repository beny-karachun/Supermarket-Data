# שקוף סל — Israeli Supermarket Price Transparency Platform

Real prices from Israel's mandated price-transparency feeds, searchable by
product, compared across the stores **near you**, cheapest first — including
active promotions. Built to push grocery competition by making price
comparison effortless.

Two apps ship from one server:

- **Consumer app** (`/consumer.html`) — Hebrew product search with
  autocomplete, promo-aware cheapest-nearby-first results, multi-store basket
  optimization with route planning on a map (Leaflet + GPS/address/CBS-aware
  geolocation).
- **Developer portal** (`/index.html`) — API playground, live ingestion
  status per chain, trigger buttons.

## Architecture

```
il-supermarket-scraper (PyPI, 14 chains configured)
        │  Stores / PriceFull / PromoFull gzipped XML
        ▼
pipeline/  (Python, stdlib only)
  fetch → parse (encoding-hardened, per-chain dialects) → load (idempotent,
  price-history deltas, per-item promo terms) → geocode (CBS locality codes,
  Nominatim w/ persistent cache) → FTS5 rebuild
        ▼
SQLite (WAL) — products, prices, promotions(+items), price_history,
               ingested_files ledger, products_fts (Hebrew-normalized FTS5)
        ▼
server.js (Express 5, read-only + pipeline spawner)
  /api/v1/search          ← cheapest-effective-price-near-you, the core query
  /api/v1/search/suggest  ← FTS prefix autocomplete
  /api/v1/prices/batch    ← whole-basket pricing in one round-trip
  /api/v1/products/:barcode/history
  + legacy: /chains /stores /products /prices /scraper-status /trigger-scrape
        ▼
public/ (vanilla JS, RTL, mobile-friendly)
```

Python owns all DB writes; Node reads (WAL allows concurrent ingest+serve).

## Quick start

```bash
# 1. Node deps + Python venv (two-step scraper install, see requirements.txt)
npm ci
./scripts/setup_venv.sh

# 2. Ingest real data — start small (one chain, a few files):
.venv/bin/python -m pipeline.run --init-db --chains shufersal --limit 10

# 3. Serve
npm start          # http://localhost:3000/consumer.html
```

Scale up ingestion when ready:

```bash
# All 14 chains, capped per chain (good first full pass; ~1-2h, a few GB):
.venv/bin/python -m pipeline.run --chains all --limit 60

# Uncapped nightly refresh (the law mandates daily full files):
.venv/bin/python -m pipeline.run --chains all
```

Re-runs are idempotent: every file is recorded in `ingested_files`, stale
duplicates are skipped, prices only append to `price_history` on change.

### Demo mode (no network)

```bash
.venv/bin/python seed_production_data.py --demo --db demo.db   # synthetic data
DB_PATH=demo.db npm start
```

Never mix demo data with real data — the seeder refuses to run on a non-empty
database for that reason.

## Scheduled ingestion

Two options:

1. **In-process (node-cron):** set `ENABLE_CRON=1` (see `.env.example`);
   the server runs `pipeline.run --chains $CHAINS` on `CRON_SCHEDULE`
   (default 03:00, when chains publish their dailies).
2. **System cron:**
   ```
   0 3 * * * cd /path/to/app && .venv/bin/python -m pipeline.run --chains all >> ingest.log 2>&1
   ```

## Docker

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec app /opt/venv/bin/python -m pipeline.run --chains shufersal --limit 10
```

The SQLite DB and feed downloads live in the `./data` volume.

## Configuration

All knobs are env vars — see [.env.example](.env.example). Chains are
registered in [pipeline/config.py](pipeline/config.py); adding/removing a
chain is one line (slug → scraper enum name, Hebrew name, UI color).

## Data realities worth knowing

- **No chain publishes store coordinates.** Some (Shufersal, Rami Levy)
  report cities as CBS locality codes. The pipeline resolves codes via a
  cached data.gov.il lookup and geocodes city centroids immediately;
  address-level pins refine over successive runs under `GEOCODE_BUDGET`
  (Nominatim is rate-limited to 1 req/sec). `stores.geo_precision` tracks
  `address` vs `city`.
- **Promotions are per-item.** Chains publish umbrella promotions covering
  tens of thousands of items, each with its own deal price — terms live in
  `promotion_items`, never on the promotion header. Multi-buy bundles
  (e.g. "2 ב-20") are surfaced as metadata and deliberately never change
  single-unit effective prices.
- **Search normalization:** geresh/gershayim and ASCII quotes are stripped at
  index time and query time (so `קוטג'` ≡ `קוטג`). The rule lives in
  `pipeline/db.py` and `lib/db.js` — keep them in sync.
- **Volume:** a full uncapped ingest of 14 chains is several GB of downloads
  and a multi-GB database. Use `--limit` and chain subsets in development.

## Tests

```bash
npm test                      # API integration suite (node:test + supertest)
.venv/bin/pytest tests/python # parser/loader/FTS unit tests
```

CI runs both on every push (`.github/workflows/ci.yml`).

## Pipeline CLI reference

```
python -m pipeline.run
  --chains all|slug,slug     chains to ingest (see pipeline/config.py)
  --types stores,pricefull,promofull
  --limit N                  max files per chain (dev)
  --skip-fetch               ingest whatever is already in DUMPS_DIR
  --init-db                  run schema migration first
  --db PATH                  database path (default: env DB_PATH)
  --keep-files               keep raw feeds after loading
  --geocode-budget N         address-level Nominatim lookups this run
```
