"""Loads parsed feed data into SQLite. One transaction per file; every file is
recorded in ingested_files so re-runs are no-ops and one bad file never aborts
a chain.
"""
import os
from datetime import datetime

from .parse import (file_meta, header_meta, parse_pricefull_file,
                    parse_promofull_file, parse_stores_file)

BATCH = 5000


def _now():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def already_done(conn, filename):
    row = conn.execute(
        "SELECT 1 FROM ingested_files WHERE filename = ? AND status = 'done'",
        (os.path.basename(filename),)).fetchone()
    return row is not None


def record_file(conn, path, chain_slug, store_id, status, row_count=0, error=None):
    file_type, official_chain, timestamp, _ = file_meta(path)
    conn.execute(
        """INSERT INTO ingested_files
             (filename, chain_id, store_id, file_type, file_timestamp,
              processed_at, row_count, status, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(filename) DO UPDATE SET
             processed_at = excluded.processed_at,
             row_count = excluded.row_count,
             status = excluded.status,
             error = excluded.error""",
        (os.path.basename(path), chain_slug, store_id, file_type, timestamp,
         _now(), row_count, status, error))
    if official_chain and chain_slug:
        conn.execute(
            'UPDATE chains SET official_chain_id = ? WHERE id = ? AND official_chain_id IS NULL',
            (official_chain, chain_slug))


def newest_per_store(paths):
    """Among unprocessed files, keep only the newest per dedup key (feed+store).
    Returns (keep_list, stale_list)."""
    groups = {}
    for path in paths:
        _, _, timestamp, dedup_key = file_meta(path)
        groups.setdefault(dedup_key, []).append((timestamp or '', path))
    keep, stale = [], []
    for entries in groups.values():
        entries.sort()
        keep.append(entries[-1][1])
        stale.extend(p for _, p in entries[:-1])
    return keep, stale


def _store_row_id(conn, chain_slug, store_num):
    """Canonical stores.id; creates a coordinate-less placeholder when the
    stores feed hasn't delivered this branch yet (geocoded on a later pass)."""
    store_id = f'{chain_slug}_{int(store_num)}' if str(store_num).isdigit() \
        else f'{chain_slug}_{store_num}'
    row = conn.execute('SELECT 1 FROM stores WHERE id = ?', (store_id,)).fetchone()
    if not row:
        chain_name = conn.execute('SELECT name_he FROM chains WHERE id = ?',
                                  (chain_slug,)).fetchone()
        display = f'{chain_name[0] if chain_name else chain_slug} סניף {store_num}'
        conn.execute(
            """INSERT INTO stores (id, chain_id, store_id, name, address, city)
               VALUES (?, ?, ?, ?, '', '')""",
            (store_id, chain_slug, str(store_num), display))
    return store_id


def load_stores(conn, path, chain_slug, geo):
    """Upsert branches; never downgrade address-precision coords to city ones."""
    count = 0
    for row in parse_stores_file(path):
        lat, lon, precision = geo.locate_store(row['address'], row['city_raw'],
                                               row['lat'], row['lon'])
        city = geo.resolve_city(row['city_raw']) or ''
        store_id = f"{chain_slug}_{int(row['store_num'])}" if row['store_num'].isdigit() \
            else f"{chain_slug}_{row['store_num']}"
        conn.execute(
            """INSERT INTO stores (id, chain_id, store_id, name, address, city,
                                   latitude, longitude, geo_precision)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 address = excluded.address,
                 city = CASE WHEN excluded.city != '' THEN excluded.city ELSE stores.city END,
                 latitude = CASE WHEN stores.geo_precision = 'address'
                                  AND excluded.geo_precision != 'address'
                                 THEN stores.latitude ELSE excluded.latitude END,
                 longitude = CASE WHEN stores.geo_precision = 'address'
                                   AND excluded.geo_precision != 'address'
                                  THEN stores.longitude ELSE excluded.longitude END,
                 geo_precision = CASE WHEN stores.geo_precision = 'address'
                                 THEN 'address' ELSE excluded.geo_precision END""",
            (store_id, chain_slug, row['store_num'], row['name'], row['address'],
             city, lat, lon, precision))
        count += 1
    conn.commit()
    return count


def load_pricefull(conn, path, chain_slug):
    header = header_meta(path)
    _, _, file_ts, _ = file_meta(path)
    store_num = header.get('storeid')
    if not store_num:
        raise ValueError('no StoreID in file header')
    store_id = _store_row_id(conn, chain_slug, store_num)

    existing = dict(conn.execute(
        'SELECT barcode, price FROM prices WHERE store_id = ?', (store_id,)))
    now = _now()

    products, prices, history = [], [], []
    count = 0

    def flush():
        if products:
            conn.executemany(
                """INSERT INTO products (barcode, name, manufacturer, brand,
                                         unit_qty, unit_of_measure, is_weighted,
                                         first_seen, last_seen)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(barcode) DO UPDATE SET
                     last_seen = excluded.last_seen,
                     name = excluded.name,
                     manufacturer = CASE WHEN excluded.manufacturer != ''
                                    THEN excluded.manufacturer ELSE products.manufacturer END""",
                products)
        if prices:
            conn.executemany(
                'INSERT OR REPLACE INTO prices VALUES (?, ?, ?, ?, ?)', prices)
        if history:
            conn.executemany(
                """INSERT OR IGNORE INTO price_history
                     (store_id, barcode, price, unit_price, changed_at)
                   VALUES (?, ?, ?, ?, ?)""", history)
        products.clear(); prices.clear(); history.clear()

    for item in parse_pricefull_file(path):
        barcode = item['barcode']
        updated = item['updated'] or file_ts or now
        products.append((barcode, item['name'], item['manufacturer'], item['brand'],
                         item['qty'], item['unit_name'], item['is_weighted'], now, now))
        prices.append((store_id, barcode, item['price'], item['unit_price'], updated))
        old = existing.get(barcode)
        if old is None or abs(old - item['price']) >= 0.01:
            history.append((store_id, barcode, item['price'], item['unit_price'], updated))
        count += 1
        if count % BATCH == 0:
            flush()
    flush()
    conn.commit()
    return count, store_id


def load_promofull(conn, path, chain_slug):
    header = header_meta(path)
    store_num = header.get('storeid')
    if not store_num:
        raise ValueError('no StoreID in file header')
    store_id = _store_row_id(conn, chain_slug, store_num)

    # PromoFull is a complete snapshot of the store's promotions.
    conn.execute('DELETE FROM promotions WHERE store_id = ?', (store_id,))

    count = 0
    for promo in parse_promofull_file(path):
        cur = conn.execute(
            """INSERT INTO promotions
                 (chain_id, store_id, promotion_id, description, start_date,
                  end_date, min_qty, discounted_price, discount_rate,
                  discount_type, requires_club, club_id, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(store_id, promotion_id) DO NOTHING""",
            (chain_slug, store_id, promo['promotion_id'], promo['description'],
             promo['start'], promo['end'], promo['min_qty'],
             promo['discounted_price'], promo['discount_rate'],
             promo['discount_type'], promo['requires_club'], promo['club_id'],
             promo['updated']))
        if cur.rowcount:
            row_id = cur.lastrowid
            conn.executemany(
                """INSERT OR IGNORE INTO promotion_items
                     (promotion_row_id, barcode, is_gift_item, min_qty,
                      discounted_price, discount_rate)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                [(row_id, it['barcode'], it['is_gift'], it['min_qty'],
                  it['discounted_price'], it['discount_rate'])
                 for it in promo['items']])
            count += 1
    conn.commit()
    return count, store_id
