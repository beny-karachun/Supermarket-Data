import gzip
import os

import pytest

from pipeline.parse import (compute_unit_price, file_meta, open_xml,
                            parse_pricefull_file, parse_promofull_file,
                            parse_stores_file)

FIXTURES = os.path.join(os.path.dirname(__file__), 'fixtures')
PRICEFULL = os.path.join(FIXTURES, 'PriceFull7290000000001-001-005-20260601-030000.xml')
PROMOFULL = os.path.join(FIXTURES, 'PromoFull7290000000001-001-005-20260601-030000.xml')
STORES = os.path.join(FIXTURES, 'Stores7290000000001-000-20260601-020000.xml')


class TestFileMeta:
    def test_pricefull_five_segment(self):
        ftype, chain, ts, dedup = file_meta('PriceFull7290027600007-001-001-20260612-030000.xml')
        assert ftype == 'pricefull'
        assert chain == '7290027600007'
        assert ts == '2026-06-12 03:00:00'
        assert dedup == 'PriceFull7290027600007-001-001'

    def test_stores_short_time(self):
        # Shufersal publishes 3-digit time segments in stores files
        ftype, chain, ts, dedup = file_meta('Stores7290027600007-000-20260612-020.gz')
        assert ftype == 'stores'
        assert ts == '2026-06-12 02:00:00'

    def test_promofull_beats_promo_prefix(self):
        ftype, _, _, _ = file_meta('PromoFull7290058140886-001-044-20260612-001124.gz')
        assert ftype == 'promofull'

    def test_dedup_key_distinguishes_stores(self):
        _, _, _, key_a = file_meta('PriceFull7290000000001-001-005-20260601-030000.xml')
        _, _, _, key_b = file_meta('PriceFull7290000000001-001-006-20260601-030000.xml')
        assert key_a != key_b


class TestUnitPrice:
    def test_grams_per_100(self):
        assert compute_unit_price(11.5, 439, 'גרם') == pytest.approx(2.62, abs=0.01)

    def test_plural_grams_variant(self):
        # Rami Levy publishes 'גרמים' on thousands of items; a miss here
        # silently degrades to per-gram pricing (off by 100x)
        assert compute_unit_price(5.9, 250, 'גרמים') == pytest.approx(2.36)
        assert compute_unit_price(2.8, 100, 'גרמים') == pytest.approx(2.80)

    def test_kilo_normalized_to_100g(self):
        # 2kg for 40 -> 2 per 100g, same basis as gram-priced items
        assert compute_unit_price(40, 2, 'ק"ג') == pytest.approx(2.0)

    def test_liter_normalized_to_100ml(self):
        assert compute_unit_price(6.2, 1, 'ליטר') == pytest.approx(0.62)

    def test_units_priced_per_unit(self):
        assert compute_unit_price(8.9, 6, 'יחידות') == pytest.approx(1.48, abs=0.01)

    def test_zero_quantity_falls_back_to_price(self):
        assert compute_unit_price(7.0, 0, 'גרם') == 7.0


class TestPriceFullParse:
    def test_items_and_fields(self):
        items = list(parse_pricefull_file(PRICEFULL))
        assert len(items) == 3  # the priceless row is dropped
        cottage = items[0]
        assert cottage['barcode'] == '7290000042420'
        assert cottage['price'] == 5.90
        assert cottage['unit_price'] == pytest.approx(2.36)
        assert cottage['updated'] == '2026-06-01 02:36:00'
        assert cottage['manufacturer'] == 'תנובה'

    def test_unknown_manufacturer_blanked(self):
        items = list(parse_pricefull_file(PRICEFULL))
        assert items[1]['manufacturer'] == ''

    def test_weighted_flag(self):
        items = list(parse_pricefull_file(PRICEFULL))
        assert items[2]['is_weighted'] == 1


class TestPromoFullParse:
    def test_promotions_parsed(self):
        promos = {p['promotion_id']: p for p in parse_promofull_file(PROMOFULL)}
        assert set(promos) == {'1001', '1002', '1003'}

    def test_per_item_deal_terms(self):
        promos = {p['promotion_id']: p for p in parse_promofull_file(PROMOFULL)}
        item = promos['1001']['items'][0]
        assert item['discounted_price'] == 4.90
        assert item['min_qty'] == 1

    def test_club_detection(self):
        promos = {p['promotion_id']: p for p in parse_promofull_file(PROMOFULL)}
        assert promos['1001']['requires_club'] == 0
        assert promos['1002']['requires_club'] == 1
        # '0 - כלל הלקוחות' means everyone
        assert promos['1003']['requires_club'] == 0

    def test_fake_barcodes_skipped(self):
        promos = {p['promotion_id']: p for p in parse_promofull_file(PROMOFULL)}
        barcodes = [i['barcode'] for i in promos['1002']['items']]
        assert '0000000000000' not in barcodes

    def test_multibuy_not_in_unit_deal_summary(self):
        promos = {p['promotion_id']: p for p in parse_promofull_file(PROMOFULL)}
        # promo 1002 is 2-for-10: no single-unit price may be derived from it
        assert promos['1002']['discounted_price'] is None
        assert promos['1002']['min_qty'] == 2


class TestStoresParse:
    def test_rows(self):
        rows = list(parse_stores_file(STORES))
        assert len(rows) == 3
        assert rows[0]['city_raw'] == 'תל אביב'
        assert rows[1]['city_raw'] == '2530'


class TestEncoding:
    def test_cp1255_bytes_behind_utf8_declaration(self, tmp_path):
        text = '<?xml version="1.0" encoding="UTF-8"?><Root><Name>שלום</Name></Root>'
        bad = tmp_path / 'bad_enc.xml'
        bad.write_bytes(text.encode('cp1255'))
        import xml.etree.ElementTree as ET
        tree = ET.parse(open_xml(str(bad)))
        assert tree.findtext('Name') == 'שלום'

    def test_gzip_supported(self, tmp_path):
        gz = tmp_path / 'PriceFull7290000000001-001-005-20260601-030000.gz'
        with open(PRICEFULL, 'rb') as f, gzip.open(gz, 'wb') as out:
            out.write(f.read())
        assert len(list(parse_pricefull_file(str(gz)))) == 3

    def test_garbage_fails_at_parse_not_silently(self, tmp_path):
        # Arbitrary bytes always decode under some fallback codec, so the
        # contract is: garbage surfaces as a parse error during consumption
        # (isolated per file by the loader), never as silent bad data.
        import xml.etree.ElementTree as ET
        bad = tmp_path / 'junk.xml'
        bad.write_bytes(b'\xff\xfe\xff\x00garbage\xff')
        with pytest.raises(ET.ParseError):
            list(parse_pricefull_file(str(bad)))
