"""Shared database helpers: connections, Hebrew normalization, FTS rebuild."""
import os
import re
import sqlite3

from .config import DB_PATH

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')

# Stripped from indexed text AND from search queries (Node keeps a JS copy of
# this rule in lib/db.js — keep the two in sync): geresh, gershayim, ASCII
# quotes/backtick. Makes קוטג' ≡ קוטג and צה״ל ≡ צהל.
_QUOTE_CHARS_RE = re.compile(r"[׳״'\"`]")


def get_conn(db_path=None):
    conn = sqlite3.connect(db_path or DB_PATH)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def normalize_hebrew(text):
    if not text:
        return ''
    return _QUOTE_CHARS_RE.sub('', str(text)).strip()


# Same normalization expressed in SQL so the FTS rebuild is one statement.
_SQL_NORM = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE({col}, ''), '׳', ''), '״', ''), '''', ''), '\"', ''), '`', '')"


def rebuild_fts(conn):
    """Repopulate products_fts from products with normalized text."""
    cur = conn.cursor()
    cur.execute('DELETE FROM products_fts')
    cur.execute(
        "INSERT INTO products_fts (barcode, name, brand, manufacturer) "
        "SELECT barcode, {name}, {brand}, {manufacturer} FROM products".format(
            name=_SQL_NORM.format(col='name'),
            brand=_SQL_NORM.format(col='brand'),
            manufacturer=_SQL_NORM.format(col='manufacturer'),
        )
    )
    conn.commit()
