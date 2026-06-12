import pytest

from pipeline.geocode import GeoResolver, clean_address


class TestCleanAddress:
    def test_junk_rejected(self):
        # Rami Levy ships its website URL as the address for some branches
        assert clean_address('https://www.rami-levy.co.il/he') is None
        assert clean_address('') is None
        assert clean_address('0') is None

    def test_country_and_city_dup_dropped(self):
        assert clean_address('לחי 16 , ראשון לציון , ישראל', 'ראשון לציון') == 'לחי 16'

    def test_street_prefix_stripped(self):
        assert clean_address("רח' גוט לוין 48") == 'גוט לוין 48'
        assert clean_address('רח.אורן 25 רוממה') == 'אורן 25 רוממה'

    def test_plain_address_untouched(self):
        assert clean_address('בן יהודה 195', 'תל אביב - יפו') == 'בן יהודה 195'


class TestAddressValidation:
    """A Nominatim hit must land near its own city or it is discarded —
    truncated feed addresses match same-named streets in other cities,
    which is worse than the city-centroid fallback."""

    def _resolver(self, tmp_path, hit):
        geo = GeoResolver(data_dir=str(tmp_path), budget=5)
        geo._nominatim = lambda q: hit
        return geo

    def test_wrong_city_hit_rejected(self, tmp_path):
        geo = self._resolver(tmp_path, (32.7940, 34.9896))  # Haifa
        assert geo.address_coords('הרצל 10', 'תל אביב') is None

    def test_rejection_cached_without_budget_burn(self, tmp_path):
        geo = self._resolver(tmp_path, (32.7940, 34.9896))
        geo.address_coords('הרצל 10', 'תל אביב')
        budget_after_first = geo.budget
        assert geo.address_coords('הרצל 10', 'תל אביב') is None
        assert geo.budget == budget_after_first

    def test_close_hit_accepted(self, tmp_path):
        geo = self._resolver(tmp_path, (32.0900, 34.7800))
        assert geo.address_coords('בן יהודה 195', 'תל אביב') == pytest.approx((32.09, 34.78))

    def test_budget_zero_means_no_lookup(self, tmp_path):
        geo = GeoResolver(data_dir=str(tmp_path), budget=0)
        geo._nominatim = lambda q: (32.09, 34.78)
        assert geo.address_coords('בן יהודה 195', 'תל אביב') is None


class TestCityCentroid:
    """City coords must be the built-up center (OSM place node), not the
    municipal polygon centroid — Nof HaGalil's polygon centroid is forest."""

    def test_place_node_preferred_over_boundary(self, tmp_path):
        geo = GeoResolver(data_dir=str(tmp_path), budget=5)
        geo._nominatim_search = lambda q, limit=1: [
            {'osm_type': 'relation', 'class': 'boundary', 'type': 'administrative',
             'lat': '32.69', 'lon': '35.36'},
            {'osm_type': 'node', 'class': 'place', 'type': 'town',
             'lat': '32.708', 'lon': '35.317'},
        ]
        assert geo.city_coords('נוף הגליל') == (32.708, 35.317)

    def test_boundary_fallback_when_no_place_node(self, tmp_path):
        geo = GeoResolver(data_dir=str(tmp_path), budget=5)
        geo._nominatim_search = lambda q, limit=1: [
            {'osm_type': 'relation', 'class': 'boundary', 'type': 'administrative',
             'lat': '32.69', 'lon': '35.36'},
        ]
        assert geo.city_coords('עיר בדיונית') == (32.69, 35.36)

    def test_city_failure_cached(self, tmp_path):
        calls = []
        geo = GeoResolver(data_dir=str(tmp_path), budget=5)
        geo._nominatim_search = lambda q, limit=1: calls.append(q) or []
        assert geo.city_coords('לא קיימת') is None
        assert geo.city_coords('לא קיימת') is None
        assert len(calls) == 1

    def test_builtin_city_needs_no_network(self, tmp_path):
        geo = GeoResolver(data_dir=str(tmp_path), budget=0)
        geo._nominatim_search = lambda q, limit=1: pytest.fail('network lookup attempted')
        assert geo.city_coords('תל אביב') == (32.0853, 34.7818)
