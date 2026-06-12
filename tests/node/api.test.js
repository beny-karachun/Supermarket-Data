// API integration tests against a small fixture DB built from the same
// pipeline/schema.sql the real database uses (single-source DDL).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURE_DB = path.join(os.tmpdir(), `shakufsal-test-${process.pid}.db`);
process.env.DB_PATH = FIXTURE_DB; // must be set before requiring the app

const sqlite3 = require('sqlite3');

// Same normalization as lib/db.js / pipeline/db.py
const norm = (s) => String(s).replace(/[׳״'"`]/g, '').trim();

function buildFixtureDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(FIXTURE_DB);
    const schema = fs.readFileSync(
      path.join(__dirname, '..', '..', 'pipeline', 'schema.sql'), 'utf-8');
    const now = new Date();
    const plus30 = new Date(now.getTime() + 30 * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
    const minus30 = new Date(now.getTime() - 30 * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
    const minus60 = new Date(now.getTime() - 60 * 86400e3).toISOString().slice(0, 19).replace('T', ' ');

    db.serialize(() => {
      db.exec(schema);
      db.run(`INSERT INTO chains (id, name_he, color) VALUES
        ('chain_a', 'רשת א', '#ff0000'), ('chain_b', 'רשת ב', '#00ff00')`);
      // Two stores near Tel Aviv (32.08, 34.78), one far away in Haifa.
      db.run(`INSERT INTO stores (id, chain_id, store_id, name, address, city, latitude, longitude, geo_precision) VALUES
        ('chain_a_1', 'chain_a', '1', 'סניף קרוב א', 'הרצל 1', 'תל אביב', 32.085, 34.781, 'address'),
        ('chain_b_1', 'chain_b', '1', 'סניף קרוב ב', 'הרצל 2', 'תל אביב', 32.075, 34.779, 'address'),
        ('chain_a_2', 'chain_a', '2', 'סניף רחוק', 'חיפה 1', 'חיפה', 32.794, 34.989, 'city')`);
      db.run(`INSERT INTO products (barcode, name, manufacturer, brand, unit_qty, unit_of_measure) VALUES
        ('100', 'חלב תנובה 3%', 'תנובה', 'תנובה', 1, 'ליטר'),
        ('200', 'חלב טרה 1%', 'טרה', 'טרה', 1, 'ליטר'),
        ('300', 'קוטג'' תנובה 5%', 'תנובה', 'תנובה', 250, 'גרם')`);
      const fts = db.prepare('INSERT INTO products_fts (barcode, name, brand, manufacturer) VALUES (?, ?, ?, ?)');
      for (const [b, n, br, m] of [
        ['100', 'חלב תנובה 3%', 'תנובה', 'תנובה'],
        ['200', 'חלב טרה 1%', 'טרה', 'טרה'],
        ['300', "קוטג' תנובה 5%", 'תנובה', 'תנובה'],
      ]) fts.run(b, norm(n), norm(br), norm(m));
      fts.finalize();
      // Prices: barcode 100 cheaper at chain_b regular, but chain_a has a promo
      // taking it below; barcode 200 cheapest only at the far store.
      db.run(`INSERT INTO prices (store_id, barcode, price, unit_price, last_updated) VALUES
        ('chain_a_1', '100', 10.00, 1.00, '2026-06-01 03:00:00'),
        ('chain_b_1', '100', 9.00, 0.90, '2026-06-01 03:00:00'),
        ('chain_a_2', '100', 7.00, 0.70, '2026-06-01 03:00:00'),
        ('chain_a_1', '200', 8.00, 0.80, '2026-06-01 03:00:00'),
        ('chain_a_2', '200', 5.00, 0.50, '2026-06-01 03:00:00'),
        ('chain_a_1', '300', 6.00, 2.40, '2026-06-01 03:00:00')`);
      // Active single-unit promo on (chain_a_1, 100): 10.00 -> 7.50
      db.run(`INSERT INTO promotions (id, chain_id, store_id, promotion_id, description,
                start_date, end_date, min_qty, discounted_price, requires_club, updated_at)
              VALUES (1, 'chain_a', 'chain_a_1', 'P1', 'חלב במבצע', '${minus30}', '${plus30}', 1, 7.50, 0, '${minus30}')`);
      db.run(`INSERT INTO promotion_items (promotion_row_id, barcode, min_qty, discounted_price)
              VALUES (1, '100', 1, 7.50)`);
      // Expired promo that must NOT apply
      db.run(`INSERT INTO promotions (id, chain_id, store_id, promotion_id, description,
                start_date, end_date, min_qty, discounted_price, requires_club, updated_at)
              VALUES (2, 'chain_a', 'chain_a_1', 'P2', 'מבצע שפג', '${minus60}', '${minus30}', 1, 1.00, 0, '${minus60}')`);
      db.run(`INSERT INTO promotion_items (promotion_row_id, barcode, min_qty, discounted_price)
              VALUES (2, '100', 1, 1.00)`);
      // Multi-buy on (chain_b_1, 100): 2 for 15 — metadata only
      db.run(`INSERT INTO promotions (id, chain_id, store_id, promotion_id, description,
                start_date, end_date, min_qty, discounted_price, requires_club, updated_at)
              VALUES (3, 'chain_b', 'chain_b_1', 'P3', '2 ב-15', '${minus30}', '${plus30}', 2, 15.00, 0, '${minus30}')`);
      db.run(`INSERT INTO promotion_items (promotion_row_id, barcode, min_qty, discounted_price)
              VALUES (3, '100', 2, 15.00)`);
      db.run(`INSERT INTO scraper_status (chain_id, status, files_downloaded, size_mb)
              VALUES ('chain_a', 'idle', 0, 0), ('chain_b', 'idle', 0, 0)`, (err) => {
        db.close((closeErr) => (err || closeErr ? reject(err || closeErr) : resolve()));
      });
    });
  });
}

let app;
let request;

before(async () => {
  if (fs.existsSync(FIXTURE_DB)) fs.unlinkSync(FIXTURE_DB);
  await buildFixtureDb();
  app = require('../../server');
  request = require('supertest');
});

after(() => {
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(FIXTURE_DB + suffix); } catch { /* already gone */ }
  }
});

const TLV = { lat: 32.08, lon: 34.78 };

test('search: promo-aware cheapest-first ordering near the user', async () => {
  const res = await request(app)
    .get(`/api/v1/search?q=חלב&lat=${TLV.lat}&lon=${TLV.lon}&radius_km=10`)
    .expect(200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.count, 2); // barcode 300 (קוטג) does not match חלב

  const [first, second] = res.body.data;
  // Promo price 7.50 at chain_a_1 beats regular 9.00 at chain_b_1
  assert.equal(first.barcode, '100');
  assert.equal(first.best_price, 7.5);
  assert.equal(first.best_regular_price, 10);
  assert.equal(first.is_promo, 1);
  assert.equal(first.best_store_id, 'chain_a_1');
  assert.ok(first.best_store_distance_km < 10);
  // Expired promo (1.00) must not have applied
  assert.notEqual(first.best_price, 1.0);

  assert.equal(second.barcode, '200');
  assert.equal(second.best_price, 8); // far-store 5.00 excluded by radius
  assert.equal(second.store_count, 1);
});

test('search: radius excludes far stores', async () => {
  const res = await request(app)
    .get(`/api/v1/search?q=חלב&lat=${TLV.lat}&lon=${TLV.lon}&radius_km=200`)
    .expect(200);
  const milk200 = res.body.data.find(r => r.barcode === '200');
  assert.equal(milk200.best_price, 5); // far store now included
  assert.equal(milk200.store_count, 2);
});

test('search: geresh-insensitive matching', async () => {
  for (const q of ['קוטג', "קוטג'"]) {
    const res = await request(app)
      .get(`/api/v1/search?q=${encodeURIComponent(q)}&lat=${TLV.lat}&lon=${TLV.lon}&radius_km=10`)
      .expect(200);
    assert.equal(res.body.count, 1, `query ${q}`);
    assert.equal(res.body.data[0].barcode, '300');
  }
});

test('search: unit_price sort changes ordering', async () => {
  const res = await request(app)
    .get(`/api/v1/search?q=חלב&lat=${TLV.lat}&lon=${TLV.lon}&radius_km=10&sort=unit_price`)
    .expect(200);
  const unitPrices = res.body.data.map(r => r.best_unit_price);
  assert.deepEqual([...unitPrices].sort((a, b) => a - b), unitPrices);
});

test('search: missing q is a 400', async () => {
  const res = await request(app).get('/api/v1/search').expect(400);
  assert.equal(res.body.success, false);
});

test('suggest: returns deduplicated names', async () => {
  const res = await request(app).get('/api/v1/search/suggest?q=חלב').expect(200);
  assert.ok(res.body.count >= 2);
  const names = res.body.data.map(r => r.name);
  assert.equal(new Set(names).size, names.length);
});

test('prices/batch: effective prices, multibuy metadata, caps', async () => {
  const res = await request(app)
    .post('/api/v1/prices/batch')
    .send({ barcodes: ['100'], store_ids: ['chain_a_1', 'chain_b_1'] })
    .expect(200);
  const byStore = Object.fromEntries(res.body.data.map(r => [r.store_id, r]));
  assert.equal(byStore.chain_a_1.effective_price, 7.5);
  assert.equal(byStore.chain_a_1.is_promo, 1);
  assert.equal(byStore.chain_b_1.effective_price, 9); // multibuy must not change unit price
  assert.equal(byStore.chain_b_1.multibuy_qty, 2);
  assert.equal(byStore.chain_b_1.multibuy_total, 15);

  const tooMany = await request(app)
    .post('/api/v1/prices/batch')
    .send({ barcodes: Array.from({ length: 201 }, (_, i) => String(i)), store_ids: ['chain_a_1'] })
    .expect(400);
  assert.equal(tooMany.body.success, false);
});

test('history endpoint returns rows', async () => {
  // seed one history row directly
  const { run } = require('../../lib/db');
  await run(`INSERT INTO price_history (store_id, barcode, price, unit_price, changed_at)
             VALUES ('chain_a_1', '100', 11.0, 1.1, '2026-05-01 00:00:00')`);
  const res = await request(app).get('/api/v1/products/100/history').expect(200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.data[0].price, 11);
});

test('legacy endpoints keep their shape', async () => {
  const chains = await request(app).get('/api/v1/chains').expect(200);
  assert.equal(chains.body.success, true);
  assert.equal(chains.body.count, 2);
  assert.ok(Array.isArray(chains.body.data));

  const stores = await request(app).get('/api/v1/stores?chain_id=chain_a').expect(200);
  assert.equal(stores.body.count, 2);

  const products = await request(app).get('/api/v1/products?query=חלב').expect(200);
  assert.equal(products.body.count, 2);

  const prices = await request(app).get('/api/v1/prices?barcode=100').expect(200);
  assert.equal(prices.body.count, 3);
  assert.ok(prices.body.data[0].store_name);

  const status = await request(app).get('/api/v1/scraper-status').expect(200);
  assert.ok(status.body.data.chain_a);
});
