"""Streaming parsers for the price-transparency XML feeds.

Built against real files (June 2026): all observed chains share the layout
  Root/Chain > ChainID, SubChainID, StoreID > Items|Promotions|SubChains
but tag casing, city encoding (CBS numeric codes vs names), timestamp formats
and filename segment counts vary per chain — everything here is permissive.
"""
import gzip
import io
import os
import re
import xml.etree.ElementTree as ET

# ---------- filename metadata ----------

_TYPE_PREFIXES = (
    ('promofull', 'promofull'),
    ('pricefull', 'pricefull'),
    ('promo', 'promo'),
    ('price', 'price'),
    ('stores', 'stores'),
)


def file_meta(filename):
    """Extract (file_type, official_chain_id, timestamp_iso, dedup_key) from a
    feed filename. Segment layouts vary (chain-store-ts, chain-sub-store-date-time,
    date-time with 3..6 digit time), so: type from the prefix, chain = the
    13-digit group, date = the 8-digit 20* group, time = whatever follows it.
    dedup_key = filename up to the date (identifies feed+store across runs).
    """
    base = os.path.basename(filename)
    base = re.sub(r'\.(gz|xml)$', '', base, flags=re.I)
    lower = base.lower()

    file_type = None
    for prefix, ftype in _TYPE_PREFIXES:
        if lower.startswith(prefix):
            file_type = ftype
            break

    chain_id = None
    m = re.search(r'(?<!\d)(\d{13})(?!\d)', base)
    if m:
        chain_id = m.group(1)

    timestamp = None
    dedup_key = base
    dm = re.search(r'(?<!\d)(20\d{6})(?!\d)', base[m.end():] if m else base)
    if dm:
        date = dm.group(1)
        offset = (m.end() if m else 0) + dm.start()
        dedup_key = base[:offset].rstrip('-_')
        rest = base[offset + 8:]
        tm = re.search(r'(\d{1,6})', rest)
        hhmmss = (tm.group(1) if tm else '').ljust(6, '0')[:6]
        timestamp = (f'{date[:4]}-{date[4:6]}-{date[6:8]} '
                     f'{hhmmss[:2]}:{hhmmss[2:4]}:{hhmmss[4:6]}')
    return file_type, chain_id, timestamp, dedup_key


# ---------- robust XML opening ----------

def _read_bytes(path):
    opener = gzip.open if path.lower().endswith('.gz') else open
    with opener(path, 'rb') as f:
        return f.read()


def open_xml(path):
    """Return a BytesIO of UTF-8 XML, working around per-chain encoding sins
    (BOMs, cp1255/utf-16 bytes behind a utf-8 declaration). Validation is a
    plain utf-8 decode — cheap, and exactly the failure mode we need to catch;
    structural XML errors surface later, isolated per file by the loader."""
    raw = _read_bytes(path)
    try:
        raw.decode('utf-8')
        return io.BytesIO(raw)
    except UnicodeDecodeError:
        pass
    for enc in ('cp1255', 'utf-16'):
        try:
            text = raw.decode(enc)
            if '<?xml' in text[:200]:
                text = re.sub(r'^.*?<\?xml[^>]*\?>', '', text, count=1, flags=re.S)
            return io.BytesIO(('<?xml version="1.0" encoding="UTF-8"?>' + text).encode('utf-8'))
        except (UnicodeError, ValueError):
            continue
    raise ValueError(f'cannot decode XML: {path}')


def _findtext(elem, *names):
    for name in names:
        for candidate in (name, name.upper(), name.lower()):
            value = elem.findtext(candidate)
            if value is not None:
                return value.strip()
    return None


def _float(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _iso(value):
    """'2026-06-04T12:04:10.000' / '2026-06-04 12:04' -> '2026-06-04 12:04:10'."""
    if not value:
        return None
    value = value.strip().replace('T', ' ')
    value = re.sub(r'\.\d+$', '', value)
    return value[:19] if len(value) >= 16 else (value if len(value) >= 10 else None)


def header_meta(path):
    """StoreID / SubChainID / ChainID from the file header (authoritative,
    unlike the filename). They precede the item list in every observed feed."""
    raw = _read_bytes(path)[:4000]
    text = raw.decode('utf-8', errors='replace')
    out = {}
    for field in ('ChainID', 'SubChainID', 'StoreID'):
        m = re.search(rf'<{field}>\s*([^<]+?)\s*</{field}>', text, re.I)
        out[field.lower()] = m.group(1) if m else None
    return out


# ---------- stores ----------

def parse_stores_file(path):
    """Yield dicts: store_num, name, address, city_raw, lat, lon."""
    seen = set()
    for _event, elem in ET.iterparse(open_xml(path), events=('end',)):
        tag = elem.tag.lower()
        if tag in ('store', 'branch'):
            store_num = _findtext(elem, 'StoreId', 'StoreID')
            name = _findtext(elem, 'StoreName')
            if store_num and name and store_num not in seen:
                seen.add(store_num)
                yield {
                    'store_num': store_num,
                    'name': name,
                    'address': _findtext(elem, 'Address') or '',
                    'city_raw': _findtext(elem, 'City') or '',
                    'lat': _float(_findtext(elem, 'Latitude')),
                    'lon': _float(_findtext(elem, 'Longitude')),
                }
            elem.clear()


# ---------- prices ----------

# unit name (after quote-stripping) -> multiplier converting item quantity to
# the per-100g/100ml comparison basis; None = priced per unit/package.
_UNIT_BASIS = {
    'גרם': 0.01, 'גר': 0.01, 'גרםם': 0.01,
    'קג': 10.0, 'קילו': 10.0, 'קילוגרם': 10.0, 'קילוגרמים': 10.0,
    'מל': 0.01, 'מיליליטר': 0.01, 'מיליליטרים': 0.01,
    'ליטר': 10.0, 'ליטרים': 10.0, 'לטר': 10.0,
}

_QUOTES = re.compile(r"[׳״'\"`]")


def compute_unit_price(price, qty, unit_name):
    """Price per 100g/100ml for weight/volume items, else per single unit.
    Deterministic across chains (their UnitOfMeasurePrice bases differ)."""
    if not price or not qty or qty <= 0:
        return price
    unit = _QUOTES.sub('', (unit_name or '')).strip()
    basis = _UNIT_BASIS.get(unit)
    if basis is not None:
        return round(price / (qty * basis), 2)
    return round(price / qty, 2)


def parse_pricefull_file(path):
    """Yield item dicts from a PriceFull/Price feed."""
    for _event, elem in ET.iterparse(open_xml(path), events=('end',)):
        tag = elem.tag.lower()
        if tag in ('item', 'product'):
            barcode = _findtext(elem, 'ItemCode')
            name = _findtext(elem, 'ItemName') or _findtext(elem, 'ManufactureItemDescription')
            price = _float(_findtext(elem, 'ItemPrice'))
            if barcode and name and price and price > 0:
                qty = _float(_findtext(elem, 'Quantity'), 0.0)
                unit_name = _findtext(elem, 'UnitQty') or ''
                manufacturer = _findtext(elem, 'ManufactureName', 'ManufacturerName') or ''
                if manufacturer in ('לא ידוע', 'unknown', 'כללי'):
                    manufacturer = ''
                yield {
                    'barcode': barcode,
                    'name': name,
                    'manufacturer': manufacturer,
                    'brand': _findtext(elem, 'BrandName') or '',
                    'qty': qty,
                    'unit_name': unit_name,
                    'is_weighted': 1 if (_findtext(elem, 'bIsWeighted', 'BisWeighted') or '0').strip() in ('1', 'true', 'True') else 0,
                    'price': price,
                    'unit_price': compute_unit_price(price, qty, unit_name)
                                  or _float(_findtext(elem, 'UnitOfMeasurePrice'), price),
                    'updated': _iso(_findtext(elem, 'PriceUpdateTime', 'PriceUpdateDate')),
                }
            elem.clear()


# ---------- promotions ----------

_FAKE_BARCODE = re.compile(r'^0+$')


def parse_promofull_file(path):
    """Yield promotion dicts from a PromoFull/Promo feed.

    Deal terms are kept PER ITEM (chains publish umbrella promotions with
    thousands of items, each with its own DiscountedPrice/MinQty). The
    promotion-level min_qty/discounted_price fields are display summaries
    only — pricing must always read promotion_items.
    """
    for _event, elem in ET.iterparse(open_xml(path), events=('end',)):
        tag = elem.tag.lower()
        if tag in ('promotion', 'sale'):
            promo_id = _findtext(elem, 'PromotionId', 'PromotionID')
            if not promo_id:
                elem.clear()
                continue

            items, min_qtys, unit_deals, rates = [], [], [], []
            for item in elem.iter():
                if item.tag.lower() not in ('promotionitem', 'item'):
                    continue
                barcode = _findtext(item, 'ItemCode')
                if not barcode or len(barcode) < 5 or _FAKE_BARCODE.match(barcode):
                    continue
                min_qty = _float(_findtext(item, 'MinQty'), 1.0) or 1.0
                deal_price = _float(_findtext(item, 'DiscountedPrice'))
                rate = _float(_findtext(item, 'DiscountRate'))
                is_gift = 1 if (_findtext(item, 'IsGiftItem') or '0').strip() == '1' else 0
                items.append({'barcode': barcode, 'is_gift': is_gift,
                              'min_qty': min_qty, 'discounted_price': deal_price,
                              'discount_rate': rate})
                min_qtys.append(min_qty)
                if deal_price and deal_price > 0 and min_qty <= 1:
                    unit_deals.append(deal_price)
                if rate and rate > 0:
                    rates.append(rate)

            if items:
                club_raw = (_findtext(elem, 'ClubId', 'ClubID') or '').strip()
                requires_club = 0 if (not club_raw or club_raw == '0'
                                      or club_raw.startswith('0 ')) else 1
                yield {
                    'promotion_id': promo_id,
                    'description': _findtext(elem, 'PromotionDescription') or '',
                    'start': _iso(_findtext(elem, 'PromotionStartDateTime', 'PromotionStartDate')),
                    'end': _iso(_findtext(elem, 'PromotionEndDateTime', 'PromotionEndDate')),
                    'min_qty': min(min_qtys) if min_qtys else 1.0,
                    'discounted_price': min(unit_deals) if unit_deals else None,
                    'discount_rate': max(rates) if rates else None,
                    'discount_type': int(_float(_findtext(elem, 'DiscountType'), 0) or 0),
                    'requires_club': requires_club,
                    'club_id': club_raw or None,
                    'updated': _iso(_findtext(elem, 'PromotionUpdateTime')),
                    'items': items,
                }
            elem.clear()
