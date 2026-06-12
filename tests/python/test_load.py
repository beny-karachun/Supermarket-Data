import json
import os
import shutil

import pytest

from pipeline.db import get_conn
from pipeline.geocode import GeoResolver
from pipeline.load import (already_done, load_pricefull, load_promofull,
                           load_stores, newest_per_store, record_file)
from pipeline.migrate import migrate

FIXTURES = os.path.join(os.path.dirname(__file__), 'fixtures')
PRICEFULL = os.path.join(FIXTURES, 'PriceFull7290000000001-001-005-20260601-030000.xml')
PROMOFULL = os.path.join(FIXTURES, 'PromoFull7290000000001-001-005-20260601-030000.xml')
STORES = os.path.join(FIXTURES, 'Stores7290000000001-000-20260601-020000.xml')


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / 'test.db')
    migrate(db_path)
    conn = get_conn(db_path)
    conn.execute("INSERT OR IGNORE INTO chains (id, name_he) VALUES ('testchain', 'רשת בדיקה')")
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def geo(tmp_path):
    # Offline resolver: budget 0 (no Nominatim) and a pre-seeded CBS cache
    data_dir = str(tmp_path / 'geo')
    os.makedirs(data_dir)
    with open(os.path.join(data_dir, 'cbs_localities.json'), 'w', encoding='utf-8') as f:
        json.dump({'2530': 'באר יעקב'}, f, ensure_ascii=False)
    return GeoResolver(data_dir=data_dir, budget=0)


class TestLoadStores:
    def test_city_name_and_cbs_code_resolution(self, conn, geo):
        count = load_stores(conn, STORES, 'testchain', geo)
        assert count == 3
        rows = {r[0]: r for r in conn.execute(
            'SELECT id, city, latitude, geo_precision FROM stores')}
        assert rows['testchain_5'][1] == 'תל אביב'
        assert rows['testchain_5'][2] is not None
        assert rows['testchain_5'][3] == 'city'
        # CBS numeric code resolved via cached map
        assert rows['testchain_6'][1] == 'באר יעקב'
        assert rows['testchain_6'][2] is not None
        # junk city stays unplaced but the store row exists
        assert rows['testchain_7'][2] is None

    def test_address_precision_never_downgraded(self, conn, geo):
        load_stores(conn, STORES, 'testchain', geo)
        conn.execute("""UPDATE stores SET latitude = 32.1, longitude = 34.8,
                        geo_precision = 'address' WHERE id = 'testchain_5'""")
        conn.commit()
        load_stores(conn, STORES, 'testchain', geo)
        row = conn.execute(
            "SELECT latitude, geo_precision FROM stores WHERE id = 'testchain_5'").fetchone()
        assert row[0] == 32.1
        assert row[1] == 'address'


class TestLoadPriceFull:
    def test_load_and_history_baseline(self, conn):
        count, store_id = load_pricefull(conn, PRICEFULL, 'testchain')
        assert count == 3
        assert store_id == 'testchain_5'
        assert conn.execute('SELECT count(*) FROM prices').fetchone()[0] == 3
        assert conn.execute('SELECT count(*) FROM price_history').fetchone()[0] == 3
        first_seen = conn.execute(
            "SELECT first_seen FROM products WHERE barcode = '7290000042420'").fetchone()[0]
        assert first_seen is not None

    def test_placeholder_store_created(self, conn):
        load_pricefull(conn, PRICEFULL, 'testchain')
        row = conn.execute(
            "SELECT name, latitude FROM stores WHERE id = 'testchain_5'").fetchone()
        assert 'סניף' in row[0]
        assert row[1] is None

    def test_history_only_on_change(self, conn, tmp_path):
        load_pricefull(conn, PRICEFULL, 'testchain')
        # same prices again: no new history rows
        load_pricefull(conn, PRICEFULL, 'testchain')
        assert conn.execute('SELECT count(*) FROM price_history').fetchone()[0] == 3
        # price change: one new history row
        changed = tmp_path / 'PriceFull7290000000001-001-005-20260602-030000.xml'
        with open(PRICEFULL, encoding='utf-8') as f:
            content = f.read().replace('<ItemPrice>5.90</ItemPrice>',
                                       '<ItemPrice>6.40</ItemPrice>') \
                              .replace('2026-06-01T02:36:00<', '2026-06-02T02:36:00<')
        changed.write_text(content, encoding='utf-8')
        load_pricefull(conn, str(changed), 'testchain')
        assert conn.execute('SELECT count(*) FROM price_history').fetchone()[0] == 4
        assert conn.execute(
            "SELECT price FROM prices WHERE barcode = '7290000042420'").fetchone()[0] == 6.40


class TestLoadPromoFull:
    def test_snapshot_load(self, conn):
        count, store_id = load_promofull(conn, PROMOFULL, 'testchain')
        assert count == 3
        assert store_id == 'testchain_5'
        item = conn.execute(
            """SELECT pi.min_qty, pi.discounted_price FROM promotion_items pi
               JOIN promotions p ON p.id = pi.promotion_row_id
               WHERE p.promotion_id = '1001'""").fetchone()
        assert item == (1, 4.90)

    def test_snapshot_replaces(self, conn):
        load_promofull(conn, PROMOFULL, 'testchain')
        load_promofull(conn, PROMOFULL, 'testchain')
        assert conn.execute('SELECT count(*) FROM promotions').fetchone()[0] == 3


class TestIdempotency:
    def test_record_and_skip(self, conn):
        assert not already_done(conn, PRICEFULL)
        record_file(conn, PRICEFULL, 'testchain', 'testchain_5', 'done', 3)
        conn.commit()
        assert already_done(conn, PRICEFULL)

    def test_newest_per_store(self):
        old = 'PriceFull7290000000001-001-005-20260601-030000.xml'
        new = 'PriceFull7290000000001-001-005-20260602-030000.xml'
        other = 'PriceFull7290000000001-001-006-20260601-030000.xml'
        keep, stale = newest_per_store([old, new, other])
        assert new in keep and other in keep
        assert stale == [old]
