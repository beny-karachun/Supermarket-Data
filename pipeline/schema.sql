-- Single source of truth for the database schema (v2).
-- Executed by pipeline/migrate.py (Python) and by Node test fixtures.
-- Everything is IF NOT EXISTS so it is safe on fresh and existing databases;
-- column additions for pre-v2 databases are handled by pipeline/migrate.py.

CREATE TABLE IF NOT EXISTS chains (
    id TEXT PRIMARY KEY,
    name_he TEXT NOT NULL,
    logo_url TEXT,
    base_url TEXT,
    auth_type TEXT,
    color TEXT,
    scraper_name TEXT,
    official_chain_id TEXT
);

-- Coordinates are nullable: feeds carry no coords, geocoding fills them in
-- (geo_precision: 'address' | 'city' | NULL when unplaced).
CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,              -- "{chain_id}_{store_number}"
    chain_id TEXT NOT NULL,
    store_id TEXT NOT NULL,           -- chain-local store number
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    geo_precision TEXT,
    FOREIGN KEY(chain_id) REFERENCES chains(id)
);

CREATE TABLE IF NOT EXISTS products (
    barcode TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    manufacturer TEXT,
    brand TEXT,
    unit_qty REAL,
    unit_of_measure TEXT,
    is_weighted INTEGER DEFAULT 0,
    first_seen TEXT,
    last_seen TEXT
);

CREATE TABLE IF NOT EXISTS prices (
    store_id TEXT,
    barcode TEXT,
    price REAL NOT NULL,
    unit_price REAL NOT NULL,
    last_updated TEXT,
    PRIMARY KEY(store_id, barcode),
    FOREIGN KEY(store_id) REFERENCES stores(id),
    FOREIGN KEY(barcode) REFERENCES products(barcode)
);

CREATE TABLE IF NOT EXISTS scraper_status (
    chain_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    last_run TEXT,
    duration_sec INTEGER,
    files_downloaded INTEGER,
    size_mb REAL,
    status_code TEXT,
    error TEXT,
    FOREIGN KEY(chain_id) REFERENCES chains(id)
);

-- Promotions are per-store snapshots from PromoFull feeds.
CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    promotion_id TEXT NOT NULL,       -- chain-assigned id
    description TEXT,
    start_date TEXT,
    end_date TEXT,
    min_qty REAL DEFAULT 1,
    discounted_price REAL,
    discount_rate REAL,
    discount_type INTEGER,
    requires_club INTEGER DEFAULT 0,
    club_id TEXT,
    updated_at TEXT,
    UNIQUE(store_id, promotion_id)
);

-- Deal terms are PER ITEM: chains publish umbrella promotions covering tens
-- of thousands of items, each with its own DiscountedPrice/MinQty.
-- (DiscountedPrice is the bundle total when min_qty > 1.)
CREATE TABLE IF NOT EXISTS promotion_items (
    promotion_row_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    barcode TEXT NOT NULL,
    is_gift_item INTEGER DEFAULT 0,
    min_qty REAL DEFAULT 1,
    discounted_price REAL,
    discount_rate REAL,
    PRIMARY KEY (promotion_row_id, barcode)
) WITHOUT ROWID;

-- Appended whenever a store's price for a barcode first appears or changes.
CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL,
    barcode TEXT NOT NULL,
    price REAL NOT NULL,
    unit_price REAL,
    changed_at TEXT NOT NULL,
    UNIQUE(store_id, barcode, changed_at)
);

-- Idempotency ledger for feed files.
CREATE TABLE IF NOT EXISTS ingested_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    chain_id TEXT,
    store_id TEXT,
    file_type TEXT,                   -- pricefull | promofull | stores
    file_timestamp TEXT,
    processed_at TEXT,
    row_count INTEGER DEFAULT 0,
    status TEXT NOT NULL,             -- done | error | skipped_stale
    error TEXT
);

-- Standalone FTS index over products. Text is normalized (Hebrew/ASCII quote
-- marks stripped) by pipeline/db.py rebuild_fts; queries must apply the same
-- normalization. Display data always comes from `products`.
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
    barcode UNINDEXED,
    name,
    brand,
    manufacturer,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX IF NOT EXISTS idx_prices_barcode ON prices(barcode);
CREATE INDEX IF NOT EXISTS idx_prices_store_id ON prices(store_id);
CREATE INDEX IF NOT EXISTS idx_prices_barcode_unit ON prices(barcode, unit_price);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_stores_chain_id ON stores(chain_id);
CREATE INDEX IF NOT EXISTS idx_stores_city ON stores(city);
CREATE INDEX IF NOT EXISTS idx_promotions_store_dates ON promotions(store_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promotion_items_barcode ON promotion_items(barcode);
CREATE INDEX IF NOT EXISTS idx_price_history_lookup ON price_history(store_id, barcode, changed_at);
CREATE INDEX IF NOT EXISTS idx_ingested_files_chain ON ingested_files(chain_id, status);
