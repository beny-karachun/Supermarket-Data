"""Idempotent schema migration driven by PRAGMA user_version.

Works on a fresh (empty) database file and on a pre-v2 database created by the
original seed script. Additive only: CREATE IF NOT EXISTS + guarded ALTERs.

CLI: python -m pipeline.migrate [--db PATH]
"""
import argparse

from .config import upsert_chains
from .db import SCHEMA_PATH, get_conn, rebuild_fts

SCHEMA_VERSION = 4

# Columns added to tables that may predate the current schema
# (table -> [(column, type)]); each ALTER is guarded by PRAGMA table_info.
_COLUMN_ADDITIONS = {
    'chains': [('color', 'TEXT'), ('scraper_name', 'TEXT'), ('official_chain_id', 'TEXT')],
    'products': [('first_seen', 'TEXT'), ('last_seen', 'TEXT')],
    'stores': [('geo_precision', 'TEXT')],
    'promotion_items': [('min_qty', 'REAL DEFAULT 1'), ('discounted_price', 'REAL'),
                        ('discount_rate', 'REAL')],
}


def _existing_columns(conn, table):
    return {row[1] for row in conn.execute(f'PRAGMA table_info({table})')}


def migrate(db_path=None):
    conn = get_conn(db_path)
    version = conn.execute('PRAGMA user_version').fetchone()[0]
    if version >= SCHEMA_VERSION:
        print(f'Schema already at v{version}, nothing to do.')
        conn.close()
        return

    print(f'Migrating schema v{version} -> v{SCHEMA_VERSION}...')
    with open(SCHEMA_PATH, encoding='utf-8') as f:
        conn.executescript(f.read())

    for table, columns in _COLUMN_ADDITIONS.items():
        existing = _existing_columns(conn, table)
        for column, col_type in columns:
            if column not in existing:
                conn.execute(f'ALTER TABLE {table} ADD COLUMN {column} {col_type}')
                print(f'  added {table}.{column}')

    # Backfill product timestamps from whatever price data exists.
    conn.execute(
        """UPDATE products SET
             first_seen = COALESCE(first_seen,
               (SELECT MIN(last_updated) FROM prices WHERE prices.barcode = products.barcode)),
             last_seen = COALESCE(last_seen,
               (SELECT MAX(last_updated) FROM prices WHERE prices.barcode = products.barcode))"""
    )

    upsert_chains(conn)
    rebuild_fts(conn)
    conn.execute('ANALYZE')
    conn.execute(f'PRAGMA user_version = {SCHEMA_VERSION}')
    conn.commit()

    n_fts = conn.execute('SELECT count(*) FROM products_fts').fetchone()[0]
    print(f'Migration complete: schema v{SCHEMA_VERSION}, {n_fts} products indexed in FTS.')
    conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Migrate the database schema.')
    parser.add_argument('--db', default=None, help='Path to the SQLite database')
    args = parser.parse_args()
    migrate(args.db)
