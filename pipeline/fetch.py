"""Fetching of price-transparency feed files via il-supermarket-scraper."""
import os

from il_supermarket_scarper import ScarpingTask
from il_supermarket_scarper.utils import DumpFolderNames

from .config import CHAINS, DUMPS_DIR

# our file-type keys -> scraper FileTypesFilters enum names
FILE_TYPE_MAP = {
    'pricefull': 'PRICE_FULL_FILE',
    'promofull': 'PROMO_FULL_FILE',
    'stores': 'STORE_FILE',
    'price': 'PRICE_FILE',
    'promo': 'PROMO_FILE',
}


def fetch(chain_slugs, file_types, dumps_dir=None, limit=None, timeout_seconds=1800):
    """Download feed files for the given chains into dumps_dir (blocking)."""
    dumps_dir = dumps_dir or DUMPS_DIR
    os.makedirs(dumps_dir, exist_ok=True)
    task = ScarpingTask(
        enabled_scrapers=[CHAINS[slug][0] for slug in chain_slugs],
        files_types=[FILE_TYPE_MAP[t] for t in file_types],
        multiprocessing=int(os.environ.get('SCRAPER_PROCS', '4')),
        output_configuration={'output_mode': 'disk', 'base_storage_path': dumps_dir},
        status_configuration={'database_type': 'json',
                              'base_path': os.path.join(dumps_dir, 'status')},
        timeout_in_seconds=timeout_seconds,
    )
    task.start(limit=limit)
    task.join()
    return dumps_dir


def discover_files(dumps_dir=None, chain_slugs=None):
    """Walk dumps_dir and return [(path, chain_slug)] for every feed file.

    Chain is inferred from the per-scraper subfolder name; files in
    unrecognized folders get slug None (callers may fall back to the
    ChainId embedded in the filename).
    """
    dumps_dir = dumps_dir or DUMPS_DIR
    folder_to_slug = {}
    for slug, (scraper_name, _, _) in CHAINS.items():
        try:
            folder_to_slug[DumpFolderNames[scraper_name].value.lower()] = slug
        except KeyError:
            folder_to_slug[scraper_name.lower()] = slug
    wanted = set(chain_slugs) if chain_slugs else None
    found = []
    for root, dirs, files in os.walk(dumps_dir):
        dirs[:] = [d for d in dirs if d != 'status']
        slug = folder_to_slug.get(os.path.basename(root).lower())
        if wanted is not None and slug not in wanted:
            continue
        for fn in sorted(files):
            if fn.lower().endswith(('.gz', '.xml')):
                found.append((os.path.join(root, fn), slug))
    return found
