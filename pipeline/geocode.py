"""Store geolocation. No Israeli chain publishes coordinates in its Stores
feed, and some (Shufersal, Rami Levy) report the city as a CBS locality code,
so placing stores on the map takes three layers:

1. CBS locality code -> Hebrew name, fetched once from data.gov.il and cached.
2. City name -> coords: builtin table of major cities, then cached Nominatim.
3. Optional per-address Nominatim refinement, budgeted per run so a full
   ingest is never blocked on the 1 req/sec rate limit; precision improves
   across runs and is tracked in stores.geo_precision ('address' | 'city').

All lookups (including failures) persist in data/geocode_cache.json.
"""
import json
import math
import os
import re
import time
import urllib.parse
import urllib.request

from .config import ROOT

CBS_LOCALITIES_URL = (
    'https://data.gov.il/api/3/action/datastore_search'
    '?resource_id=64edd0ee-3d5d-43ce-8562-c336c24dbc1f&limit=2000'
)
NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
USER_AGENT = 'shakuf-sal-price-pipeline/1.0 (open data project)'

DATA_DIR = os.environ.get('GEO_CACHE_DIR', os.path.join(ROOT, 'data'))

# Major-city coordinates (city-level precision), so a fresh ingest places most
# stores without any network geocoding.
CITY_COORDS = {
    'ירושלים': (31.7683, 35.2137), 'תל אביב': (32.0853, 34.7818),
    'תל אביב - יפו': (32.0853, 34.7818), 'תל אביב-יפו': (32.0853, 34.7818),
    'חיפה': (32.7940, 34.9896), 'באר שבע': (31.2530, 34.7915),
    'ראשון לציון': (31.9730, 34.7925), 'פתח תקווה': (32.0871, 34.8875),
    'רחובות': (31.8928, 34.8113), 'נתניה': (32.3215, 34.8532),
    'חולון': (32.0162, 34.7772), 'בת ים': (32.0171, 34.7435),
    'רמת גן': (32.0823, 34.8107), 'הרצליה': (32.1664, 34.8433),
    'אשדוד': (31.7921, 34.6333), 'כפר סבא': (32.1750, 34.9064),
    'רעננה': (32.1848, 34.8713), 'מודיעין': (31.8998, 35.0076),
    'מודיעין מכבים רעות': (31.8998, 35.0076), 'בני ברק': (32.0833, 34.8333),
    'אשקלון': (31.6693, 34.5715), 'בית שמש': (31.7470, 34.9881),
    'חדרה': (32.4340, 34.9197), 'לוד': (31.9510, 34.8881),
    'רמלה': (31.9275, 34.8631), 'גבעתיים': (32.0722, 34.8125),
    'הוד השרון': (32.1553, 34.8926), 'קרית גת': (31.6034, 34.7718),
    'נהריה': (32.9996, 35.0933), 'נהרייה': (32.9996, 35.0933),
    'עפולה': (32.6078, 35.2897), 'אילת': (29.5577, 34.9519),
    'קרית אתא': (32.8028, 35.1039), 'אום אל-פחם': (32.5167, 35.1500),
    'קרית מוצקין': (32.8392, 35.0761), 'קרית ים': (32.8464, 35.0683),
    'קרית ביאליק': (32.8319, 35.0903), 'רמת השרון': (32.1392, 34.8397),
    'טבריה': (32.7922, 35.5312), 'נצרת': (32.6996, 35.3035),
    'טייבה': (32.2647, 35.0125), 'נס ציונה': (31.9250, 34.7981),
    'קרית שמונה': (33.2078, 35.5700), 'כרמיאל': (32.9100, 35.2900),
    'דימונה': (31.0694, 34.9819), 'אור יהודה': (32.0306, 34.8519),
    'יבנה': (31.8781, 34.7397), 'יהוד': (32.0322, 34.8967),
    'צפת': (32.9658, 35.4983), 'ערד': (31.2614, 35.2147),
    'שדרות': (31.5233, 34.5947), 'אופקים': (31.3144, 34.6200),
    'נתיבות': (31.4189, 34.5950), 'שפרעם': (32.8056, 35.1706),
    'מעלות תרשיחא': (33.0114, 35.2683), 'מגדל העמק': (32.6736, 35.2403),
    'בית שאן': (32.4972, 35.4975), 'נשר': (32.7631, 35.0394),
    'קרית אונו': (32.0628, 34.8572), 'באר יעקב': (31.9447, 34.8408),
    'גן יבנה': (31.7873, 34.7060), 'גדרה': (31.8148, 34.7785),
    'מבשרת ציון': (31.8030, 35.1500), 'מעלה אדומים': (31.7730, 35.2990),
    'אריאל': (32.1056, 35.1773), 'זכרון יעקב': (32.5719, 34.9526),
    'עכו': (32.9281, 35.0756), 'טירת כרמל': (32.7686, 34.9697),
    'יקנעם עילית': (32.6594, 35.1100), 'ראש העין': (32.0956, 34.9567),
    'שוהם': (31.9989, 34.9456), 'אלעד': (32.0522, 34.9511),
    'ביתר עילית': (31.6967, 35.1136), 'גבעת שמואל': (32.0781, 34.8475),
    'קרית מלאכי': (31.7290, 34.7458), 'אבן יהודה': (32.2697, 34.8878),
    'פרדס חנה-כרכור': (32.4760, 34.9676), 'פרדס חנה כרכור': (32.4760, 34.9676),
    'כפר יונה': (32.3171, 34.9358), 'טירה': (32.2331, 34.9508),
    'כפר קאסם': (32.1142, 34.9771), 'סחנין': (32.8642, 35.2972),
    'עתלית': (32.6900, 34.9400), 'קצרין': (32.9925, 35.6892),
}

_JUNK_CITIES = {'', '0', 'unknown', 'לא ידוע', 'none', 'null'}

# An address hit further than this from its own city centroid is treated as a
# wrong-city match (feeds truncate addresses; same-named streets exist in many
# cities) and discarded in favor of the centroid. Covers the largest cities.
MAX_KM_FROM_CITY = 12.0

_URL_RE = re.compile(r'https?://|www\.')
_STREET_PREFIX_RE = re.compile(r"^רח(וב)?['׳.]?\s*")


def _haversine_km(lat1, lon1, lat2, lon2):
    rlat1, rlon1, rlat2, rlon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    a = (math.sin((rlat2 - rlat1) / 2) ** 2
         + math.cos(rlat1) * math.cos(rlat2) * math.sin((rlon2 - rlon1) / 2) ** 2)
    return 2 * 6371 * math.asin(math.sqrt(a))


def clean_address(address, city_name=None):
    """Normalize a feed address for geocoding; None when it's unusable.

    Feeds ship URLs, ', ישראל' suffixes, duplicated city names and רח' prefixes
    that all hurt Nominatim hit rates.
    """
    addr = (address or '').strip()
    if not addr or addr.lower() in _JUNK_CITIES or _URL_RE.search(addr):
        return None
    segments = [seg.strip() for seg in addr.split(',')]
    segments = [seg for seg in segments
                if seg and seg != 'ישראל' and (not city_name or seg != city_name)]
    if not segments:
        return None
    addr = ', '.join(segments)
    addr = _STREET_PREFIX_RE.sub('', addr)
    return re.sub(r'\s+', ' ', addr).strip() or None


class GeoResolver:
    def __init__(self, data_dir=None, budget=None):
        self.data_dir = data_dir or DATA_DIR
        os.makedirs(self.data_dir, exist_ok=True)
        self.cache_path = os.path.join(self.data_dir, 'geocode_cache.json')
        self.cbs_path = os.path.join(self.data_dir, 'cbs_localities.json')
        self.cache = self._load_json(self.cache_path) or {}
        self.cbs_map = None  # lazy
        self.budget = budget if budget is not None else int(os.environ.get('GEOCODE_BUDGET', '150'))
        self._last_request = 0.0

    @staticmethod
    def _load_json(path):
        try:
            with open(path, encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def save(self):
        with open(self.cache_path, 'w', encoding='utf-8') as f:
            json.dump(self.cache, f, ensure_ascii=False)

    # ----- CBS locality codes -----

    def _ensure_cbs_map(self):
        if self.cbs_map is not None:
            return
        cached = self._load_json(self.cbs_path)
        if cached:
            self.cbs_map = cached
            return
        self.cbs_map = {}
        try:
            req = urllib.request.Request(CBS_LOCALITIES_URL, headers={'User-Agent': USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.load(resp)
            for rec in payload.get('result', {}).get('records', []):
                code = str(rec.get('סמל_ישוב', '')).strip()
                name = str(rec.get('שם_ישוב', '')).strip()
                if code and name and code != '0':
                    self.cbs_map[code] = name
            if self.cbs_map:
                with open(self.cbs_path, 'w', encoding='utf-8') as f:
                    json.dump(self.cbs_map, f, ensure_ascii=False)
                print(f'  fetched {len(self.cbs_map)} CBS locality codes')
        except Exception as exc:  # network failure: degrade to name-only cities
            print(f'  warning: CBS locality fetch failed ({exc}); numeric city codes will be unresolved')

    def resolve_city(self, raw):
        """Raw City field (Hebrew name or CBS numeric code) -> Hebrew name or None."""
        if raw is None:
            return None
        value = str(raw).strip()
        if value.lower() in _JUNK_CITIES:
            return None
        if value.isdigit():
            self._ensure_cbs_map()
            return self.cbs_map.get(str(int(value)))  # strip leading zeros
        return value

    # ----- coordinates -----

    def _nominatim_search(self, query, limit=1):
        """Rate-limited Nominatim lookup; returns the raw result list."""
        wait = 1.1 - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.monotonic()
        url = NOMINATIM_URL + '?' + urllib.parse.urlencode(
            {'q': query, 'format': 'json', 'limit': limit, 'countrycodes': 'il'})
        try:
            req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.load(resp) or []
        except Exception:
            return []

    def _nominatim(self, query):
        """Rate-limited Nominatim lookup; returns (lat, lon) or None."""
        results = self._nominatim_search(query, limit=1)
        if results:
            return float(results[0]['lat']), float(results[0]['lon'])
        return None

    _PLACE_NODE_TYPES = {'city', 'town', 'village', 'hamlet', 'suburb', 'locality'}

    def city_coords(self, city_name):
        """Coords of a locality's BUILT-UP center, not its municipal polygon.

        Boundary relations give the polygon's geometric centroid, which for
        cities with sprawling jurisdictions (נוף הגליל wraps around Nazareth
        and includes forest) lands kilometers into open country. OSM place
        NODES mark the actual town center — prefer them. Cache namespace is
        'cityv2:' so polygon-centroid entries from before this fix are dead.
        """
        if not city_name:
            return None
        if city_name in CITY_COORDS:
            return CITY_COORDS[city_name]
        key = f'cityv2:{city_name}'
        if key in self.cache:
            hit = self.cache[key]
            return tuple(hit) if hit else None
        results = self._nominatim_search(f'{city_name}, ישראל', limit=5)
        coords = None
        for r in results:
            if r.get('osm_type') == 'node' and r.get('class') == 'place' \
                    and r.get('type') in self._PLACE_NODE_TYPES:
                coords = (float(r['lat']), float(r['lon']))
                break
        if coords is None and results:
            coords = (float(results[0]['lat']), float(results[0]['lon']))
        self.cache[key] = list(coords) if coords else None
        return coords

    def address_coords(self, address, city_name):
        """Budgeted, validated address-level lookup; returns (lat, lon) or None.

        Cache keys are namespaced 'addrv2:' — pre-validation entries under
        'addr:' may be wrong-city hits and are deliberately not read.
        """
        addr = clean_address(address, city_name)
        if not addr:
            return None
        query = f'{addr}, {city_name}, ישראל' if city_name else f'{addr}, ישראל'
        key = f'addrv2:{query}'
        if key in self.cache:
            hit = self.cache[key]
            return tuple(hit) if hit else None
        if self.budget <= 0:
            return None
        self.budget -= 1
        coords = self._nominatim(query)
        if coords and city_name:
            centroid = self.city_coords(city_name)
            if centroid and _haversine_km(*coords, *centroid) > MAX_KM_FROM_CITY:
                coords = None  # same-named street in another city
        self.cache[key] = list(coords) if coords else None
        return coords

    def locate_store(self, address, city_raw, lat=None, lon=None):
        """Best coords for a store -> (lat, lon, precision) or (None, None, None).

        Feed-provided coords win; then cached/budgeted address geocoding;
        then city centroid.
        """
        if lat and lon and float(lat) > 29 and float(lon) > 33:
            return float(lat), float(lon), 'address'
        city = self.resolve_city(city_raw)
        addr = self.address_coords(address, city)
        if addr:
            return addr[0], addr[1], 'address'
        city_c = self.city_coords(city)
        if city_c:
            return city_c[0], city_c[1], 'city'
        return None, None, None


# ----- backfill CLI -----

def backfill(db_path, budget, revalidate=False):
    """Upgrade city-precision / unplaced stores to address precision.

    Ingest runs keep a small geocoding budget so they finish fast; this is the
    dedicated catch-up pass (1 req/1.1s against Nominatim — ~600 stores take
    ~11 minutes). Progress persists in the cache, so it is safe to interrupt
    and re-run.
    """
    import sqlite3

    from .db import get_conn

    geo = GeoResolver(budget=budget)
    conn = get_conn(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """SELECT id, name, address, city FROM stores
           WHERE latitude IS NULL OR geo_precision IS NULL OR geo_precision = 'city'
           ORDER BY id""").fetchall()
    print(f'{len(rows)} stores eligible for address geocoding (budget {budget})')

    upgraded = missed = 0
    for i, row in enumerate(rows, 1):
        if geo.budget <= 0:
            print(f'budget exhausted after {i - 1} stores')
            break
        coords = geo.address_coords(row['address'], row['city'])
        if not coords:
            # Branch names usually ARE the venue ("צים סנטר נוף הגליל") or
            # carry it in parentheses — malls and centers geocode well where
            # the street address is truncated or missing. Same validation.
            name = row['name'] or ''
            paren = re.search(r'\(([^)]{4,})\)', name)
            venue = paren.group(1) if paren else name
            if len(venue.strip()) >= 4:
                coords = geo.address_coords(venue, row['city'])
        if coords:
            conn.execute(
                "UPDATE stores SET latitude = ?, longitude = ?, geo_precision = 'address' WHERE id = ?",
                (coords[0], coords[1], row['id']))
            upgraded += 1
        else:
            missed += 1
        if i % 25 == 0:
            conn.commit()
            geo.save()
            print(f'  {i}/{len(rows)} processed — {upgraded} upgraded, {missed} no validated hit')

    # Remaining city-precision stores sit on whatever centroid the v1 cache
    # had — possibly a municipal-polygon centroid in open country. Re-place
    # them on the corrected (place-node) city centers.
    moved = rescued = 0
    for row in conn.execute(
            """SELECT id, city, latitude, longitude FROM stores
               WHERE geo_precision = 'city'""").fetchall():
        centroid = geo.city_coords(row['city'])
        if centroid and _haversine_km(centroid[0], centroid[1],
                                      row['latitude'], row['longitude']) > 0.25:
            conn.execute("UPDATE stores SET latitude = ?, longitude = ? WHERE id = ?",
                         (centroid[0], centroid[1], row['id']))
            moved += 1

    # Unplaced stores whose city failed to resolve before the place-node fix
    # get one more chance at a centroid.
    for row in conn.execute(
            """SELECT id, city FROM stores
               WHERE latitude IS NULL AND TRIM(COALESCE(city, '')) != ''""").fetchall():
        centroid = geo.city_coords(row['city'])
        if centroid:
            conn.execute(
                "UPDATE stores SET latitude = ?, longitude = ?, geo_precision = 'city' WHERE id = ?",
                (centroid[0], centroid[1], row['id']))
            rescued += 1

    demoted = 0
    if revalidate:
        # Address-precision rows placed before hit validation existed may be
        # wrong-city matches; pull implausible ones back to their city centroid.
        for row in conn.execute(
                """SELECT id, city, latitude, longitude FROM stores
                   WHERE geo_precision = 'address' AND latitude IS NOT NULL""").fetchall():
            centroid = geo.city_coords(row['city'])
            if centroid and _haversine_km(row['latitude'], row['longitude'], *centroid) > 15.0:
                conn.execute(
                    "UPDATE stores SET latitude = ?, longitude = ?, geo_precision = 'city' WHERE id = ?",
                    (centroid[0], centroid[1], row['id']))
                demoted += 1

    conn.commit()
    geo.save()
    counts = {row[0]: row[1] for row in conn.execute(
        "SELECT COALESCE(geo_precision, 'unplaced'), COUNT(*) FROM stores GROUP BY 1").fetchall()}
    conn.close()
    print(f'done: {upgraded} upgraded to address precision, {missed} unresolved, '
          f'{moved} re-centered on corrected city centroids, {rescued} rescued from unplaced, '
          f'{demoted} demoted as implausible')
    print(f'store precision now: {counts}')


def main():
    import argparse

    from .config import DB_PATH

    parser = argparse.ArgumentParser(description='Geocoding backfill for store coordinates')
    parser.add_argument('--db', default=DB_PATH)
    parser.add_argument('--budget', type=int, default=800,
                        help='max Nominatim lookups this run (1.1s each)')
    parser.add_argument('--revalidate', action='store_true',
                        help='also demote address-precision stores implausibly far from their city')
    args = parser.parse_args()
    backfill(args.db, args.budget, revalidate=args.revalidate)


if __name__ == '__main__':
    main()
