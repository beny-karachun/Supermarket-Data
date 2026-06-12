// Shared DB access for the API server: promisified sqlite3, an in-memory
// stores cache, geo helpers, and the Hebrew search normalization (kept in
// sync with pipeline/db.py — same characters stripped at index time).
const path = require('path');
const sqlite3 = require('sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.db');

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error(`Failed to open database at ${DB_PATH}:`, err.message);
  } else {
    console.log(`Connected to SQLite database: ${DB_PATH}`);
    db.exec('PRAGMA busy_timeout=5000');
  }
});

const all = (sql, params = []) => new Promise((resolve, reject) =>
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const get = (sql, params = []) => new Promise((resolve, reject) =>
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
const run = (sql, params = []) => new Promise((resolve, reject) =>
  db.run(sql, params, function onDone(err) { return err ? reject(err) : resolve(this); }));

// Must stay identical to pipeline/db.py normalize_hebrew.
function normalizeHebrew(text) {
  return String(text || '').replace(/[׳״'"`]/g, '').trim();
}

// Build an FTS5 MATCH string: every token quoted (literal), last token a
// prefix so search-as-you-type works.
function ftsMatch(query) {
  const tokens = normalizeHebrew(query).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!tokens.length) return null;
  return tokens
    .map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`))
    .join(' ');
}

// ----- stores cache (small table, refreshed every 5 minutes or on demand) -----

const STORES_TTL_MS = 5 * 60 * 1000;
let storesCache = { rows: [], byId: new Map(), at: 0 };

async function getStores(force = false) {
  if (force || Date.now() - storesCache.at > STORES_TTL_MS) {
    const rows = await all(
      `SELECT s.*, c.name_he AS chain_name, c.color AS chain_color
       FROM stores s JOIN chains c ON c.id = s.chain_id`);
    storesCache = { rows, byId: new Map(rows.map(r => [r.id, r])), at: Date.now() };
  }
  return storesCache.rows;
}

function storeById(id) {
  return storesCache.byId.get(id);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Bounding-box prefilter then exact Haversine; sorted nearest-first.
async function nearbyStores(lat, lon, radiusKm) {
  const stores = await getStores();
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos(lat * Math.PI / 180) || 1);
  const out = [];
  for (const s of stores) {
    if (s.latitude == null || s.longitude == null) continue;
    if (Math.abs(s.latitude - lat) > dLat || Math.abs(s.longitude - lon) > dLon) continue;
    const distance = haversineKm(lat, lon, s.latitude, s.longitude);
    if (distance <= radiusKm) out.push({ ...s, distance: Math.round(distance * 100) / 100 });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

module.exports = {
  DB_PATH, db, all, get, run,
  normalizeHebrew, ftsMatch,
  getStores, storeById, nearbyStores, haversineKm,
};
