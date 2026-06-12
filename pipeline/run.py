"""Ingestion orchestrator: fetch feeds, parse, load, update scraper_status.

Usage:
  python -m pipeline.run --chains all --types pricefull,promofull,stores
  python -m pipeline.run --chains shufersal,rami_levy --limit 3 --init-db
  python -m pipeline.run --chains shufersal --skip-fetch       # reuse dumps

Stores files load before price files, prices before promos, so foreign keys
always resolve. Every file lands in ingested_files (done/error/skipped_stale);
errors never abort a chain.
"""
import argparse
import os
import sys
import time
from datetime import datetime

from .config import CHAINS, DB_PATH
from .db import get_conn, rebuild_fts
from .fetch import discover_files, fetch
from .geocode import GeoResolver
from .load import (already_done, load_pricefull, load_promofull, load_stores,
                   newest_per_store, record_file)
from .migrate import migrate
from .parse import file_meta

_ORDER = {'stores': 0, 'pricefull': 1, 'price': 2, 'promofull': 3, 'promo': 4}


def set_status(conn, chain, **fields):
    sets = ', '.join(f'{k} = ?' for k in fields)
    conn.execute(f'UPDATE scraper_status SET {sets} WHERE chain_id = ?',
                 (*fields.values(), chain))
    conn.commit()


def process_chain(conn, chain, types, limit, skip_fetch, keep_files, geo):
    started = time.time()
    set_status(conn, chain, status='running', status_code='In Progress', error=None)
    files_loaded = 0
    size_mb = 0.0
    errors = []

    try:
        if not skip_fetch:
            fetch([chain], types, limit=limit)

        all_files = [p for p, slug in discover_files(chain_slugs=[chain])]
        pending = [p for p in all_files if not already_done(conn, p)]
        keep, stale = newest_per_store(pending)
        for path in stale:
            record_file(conn, path, chain, None, 'skipped_stale')
        keep.sort(key=lambda p: _ORDER.get(file_meta(p)[0] or '', 9))

        for path in keep:
            file_type = file_meta(path)[0]
            try:
                if file_type == 'stores':
                    rows = load_stores(conn, path, chain, geo)
                    record_file(conn, path, chain, None, 'done', rows)
                elif file_type in ('pricefull', 'price'):
                    rows, store_id = load_pricefull(conn, path, chain)
                    record_file(conn, path, chain, store_id, 'done', rows)
                elif file_type in ('promofull', 'promo'):
                    rows, store_id = load_promofull(conn, path, chain)
                    record_file(conn, path, chain, store_id, 'done', rows)
                else:
                    record_file(conn, path, chain, None, 'error', 0, 'unknown file type')
                    continue
                files_loaded += 1
                size_mb += os.path.getsize(path) / 1e6
                print(f'  [{chain}] {os.path.basename(path)}: {rows} rows')
            except Exception as exc:
                conn.rollback()
                errors.append(f'{os.path.basename(path)}: {exc}')
                record_file(conn, path, chain, None, 'error', 0, str(exc)[:500])
                print(f'  [{chain}] ERROR {os.path.basename(path)}: {exc}')
            finally:
                if not keep_files and os.path.exists(path):
                    os.remove(path)

        ok = files_loaded > 0 or not keep
        set_status(conn, chain,
                   status='idle' if ok else 'error',
                   status_code='Success' if ok else 'Failed',
                   last_run=datetime.now().strftime('%Y-%m-%d %H:%M'),
                   duration_sec=int(time.time() - started),
                   files_downloaded=files_loaded,
                   size_mb=round(size_mb, 1),
                   error='; '.join(errors)[:500] if errors else None)
        return ok
    except Exception as exc:
        conn.rollback()
        set_status(conn, chain, status='error', status_code='Failed',
                   last_run=datetime.now().strftime('%Y-%m-%d %H:%M'),
                   duration_sec=int(time.time() - started),
                   error=str(exc)[:500])
        print(f'  [{chain}] CHAIN FAILED: {exc}')
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(description='Fetch and ingest price-transparency feeds.')
    parser.add_argument('--chains', default='all',
                        help='"all" or comma-separated slugs: ' + ','.join(CHAINS))
    parser.add_argument('--types', default='stores,pricefull,promofull',
                        help='comma-separated: stores,pricefull,promofull,price,promo')
    parser.add_argument('--limit', type=int, default=None,
                        help='max files per chain (dev runs)')
    parser.add_argument('--skip-fetch', action='store_true',
                        help='ingest whatever is already in the dumps dir')
    parser.add_argument('--init-db', action='store_true', help='run schema migration first')
    parser.add_argument('--db', default=None, help='database path (default: env DB_PATH)')
    parser.add_argument('--keep-files', action='store_true',
                        help='do not delete feed files after ingestion')
    parser.add_argument('--geocode-budget', type=int, default=None,
                        help='max Nominatim address lookups this run')
    args = parser.parse_args(argv)

    chains = list(CHAINS) if args.chains == 'all' else [c.strip() for c in args.chains.split(',')]
    unknown = [c for c in chains if c not in CHAINS]
    if unknown:
        parser.error(f'unknown chains: {unknown}')
    types = [t.strip() for t in args.types.split(',')]

    db_path = args.db or DB_PATH
    if args.init_db or not os.path.exists(db_path):
        migrate(db_path)
    conn = get_conn(db_path)
    geo = GeoResolver(budget=args.geocode_budget)

    print(f'Ingesting {len(chains)} chain(s): {", ".join(chains)} | types: {",".join(types)}'
          + (f' | limit {args.limit}' if args.limit else ''))
    succeeded = 0
    for chain in chains:
        print(f'[{chain}] starting...')
        if process_chain(conn, chain, types, args.limit, args.skip_fetch,
                         args.keep_files, geo):
            succeeded += 1
        geo.save()

    print('Rebuilding search index...')
    rebuild_fts(conn)
    conn.execute('ANALYZE')
    conn.commit()
    conn.close()
    print(f'Done: {succeeded}/{len(chains)} chains succeeded.')
    return 0 if succeeded else 1


if __name__ == '__main__':
    sys.exit(main())
