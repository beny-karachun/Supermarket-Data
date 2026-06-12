"""Chain registry: maps our chain slug to the il-supermarket-scraper enum name,
Hebrew display name, and UI color. Adding/removing a chain is a one-line change.

15 brands via 14 scrapers (Yeinot Bitan and Carrefour/Mega share one scraper).
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DB_PATH = os.environ.get('DB_PATH', os.path.join(ROOT, 'database.db'))
DUMPS_DIR = os.environ.get('DUMPS_DIR', os.path.join(ROOT, 'data', 'dumps'))

# slug: (scraper enum name, Hebrew name, color)
CHAINS = {
    'shufersal':        ('SHUFERSAL',                 'שופרסל',              '#ef4444'),
    'rami_levy':        ('RAMI_LEVY',                 'רמי לוי',             '#f59e0b'),
    'yohananof':        ('YOHANANOF',                 'יוחננוף',             '#8b5cf6'),
    'victory':          ('VICTORY_NEW_SOURCE',        'ויקטורי',             '#06b6d4'),
    'tiv_taam':         ('TIV_TAAM',                  'טיב טעם',             '#10b981'),
    'carrefour':        ('YAYNO_BITAN_AND_CARREFOUR', 'קרפור / יינות ביתן',  '#2563eb'),
    'osher_ad':         ('OSHER_AD',                  'אושר עד',             '#dc2626'),
    'hazi_hinam':       ('HAZI_HINAM',                'חצי חינם',            '#ea580c'),
    'machsanei_hashuk': ('MAHSANI_ASHUK',             'מחסני השוק',          '#65a30d'),
    'super_pharm':      ('SUPER_PHARM',               'סופר-פארם',           '#0ea5e9'),
    'keshet_teamim':    ('KESHET',                    'קשת טעמים',           '#a855f7'),
    'king_store':       ('KING_STORE',                'קינג סטור',           '#f43f5e'),
    'maayan_2000':      ('MAAYAN_2000',               'מעיין 2000',          '#14b8a6'),
    'dor_alon':         ('DOR_ALON',                  'דור אלון',            '#eab308'),
}


def slug_for_scraper(scraper_name):
    for slug, (name, _, _) in CHAINS.items():
        if name == scraper_name:
            return slug
    return None


def upsert_chains(conn):
    """Ensure every registered chain has a chains row and a scraper_status row."""
    for slug, (scraper_name, name_he, color) in CHAINS.items():
        conn.execute(
            """INSERT INTO chains (id, name_he, color, scraper_name)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name_he = excluded.name_he,
                 color = excluded.color,
                 scraper_name = excluded.scraper_name""",
            (slug, name_he, color, scraper_name),
        )
        conn.execute(
            """INSERT OR IGNORE INTO scraper_status
               (chain_id, status, files_downloaded, size_mb)
               VALUES (?, 'idle', 0, 0)""",
            (slug,),
        )
