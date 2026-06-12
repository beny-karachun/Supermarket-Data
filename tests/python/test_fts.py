import pytest

from pipeline.db import get_conn, normalize_hebrew, rebuild_fts
from pipeline.migrate import migrate


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / 'fts.db')
    migrate(db_path)
    conn = get_conn(db_path)
    conn.executemany(
        """INSERT INTO products (barcode, name, manufacturer, brand)
           VALUES (?, ?, ?, ?)""",
        [('1', "קוטג' תנובה 5%", 'תנובה', 'תנובה'),
         ('2', 'חלב טרה 3% צה"ל מהדורה', 'טרה', 'טרה'),
         ('3', 'במבה אסם 80 גרם', 'אסם', 'במבה')])
    conn.commit()
    rebuild_fts(conn)
    yield conn
    conn.close()


def _search(conn, query):
    norm = normalize_hebrew(query)
    match = ' '.join(f'"{t}"*' for t in norm.split())
    return [r[0] for r in conn.execute(
        'SELECT barcode FROM products_fts WHERE products_fts MATCH ?', (match,))]


def test_geresh_and_plain_are_equivalent(conn):
    # The normalization contract: קוטג' (with quote) and קוטג must both hit
    assert _search(conn, 'קוטג') == ['1']
    assert _search(conn, "קוטג'") == ['1']
    assert _search(conn, 'קוטג׳') == ['1']


def test_gershayim_stripped(conn):
    assert _search(conn, 'צהל') == ['2']
    assert _search(conn, 'צה"ל') == ['2']


def test_prefix_matching(conn):
    assert _search(conn, 'במ') == ['3']


def test_rebuild_replaces(conn):
    rebuild_fts(conn)
    assert conn.execute('SELECT count(*) FROM products_fts').fetchone()[0] == 3
