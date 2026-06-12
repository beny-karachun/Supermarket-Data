const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const cron = require('node-cron');
const {
  DB_PATH, all, get, run,
  ftsMatch, getStores, storeById, nearbyStores,
} = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const nowStamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// Active single-unit deals per (barcode, store): umbrella promotions carry
// per-item prices, so terms come from promotion_items, never the promo header.
// dn = 1 picks the cheapest deal with its attribution.
const DEALS_CTE = `
  SELECT pi.barcode, pr.store_id, pi.discounted_price AS deal_price,
         pr.requires_club, pr.end_date AS promo_end,
         pr.description AS promo_description,
         ROW_NUMBER() OVER (PARTITION BY pi.barcode, pr.store_id
                            ORDER BY pi.discounted_price ASC) AS dn
  FROM promotions pr
  JOIN promotion_items pi ON pi.promotion_row_id = pr.id
  WHERE pr.store_id IN (SELECT store_id FROM nearby)
    AND pi.barcode IN (SELECT barcode FROM matched)
    AND pi.discounted_price > 0
    AND COALESCE(pi.min_qty, 1) <= 1
    AND COALESCE(pr.start_date, '0') <= $now
    AND COALESCE(pr.end_date, '9') >= $now`;

const SEARCH_SQL = `
WITH nearby AS (SELECT value AS store_id FROM json_each($stores)),
matched AS (
  SELECT barcode, rank FROM products_fts
  WHERE products_fts MATCH $match LIMIT 400
),
deals AS (${DEALS_CTE}),
effective AS (
  SELECT p.barcode, p.store_id, p.price, p.unit_price, p.last_updated,
         CASE WHEN d.deal_price IS NOT NULL AND d.deal_price < p.price
              THEN d.deal_price ELSE p.price END AS effective_price,
         CASE WHEN d.deal_price IS NOT NULL AND d.deal_price < p.price AND p.price > 0
              THEN ROUND(p.unit_price * d.deal_price / p.price, 2)
              ELSE p.unit_price END AS effective_unit_price,
         CASE WHEN d.deal_price IS NOT NULL AND d.deal_price < p.price
              THEN 1 ELSE 0 END AS is_promo,
         d.requires_club, d.promo_end, d.promo_description
  FROM prices p
  JOIN matched m ON m.barcode = p.barcode
  JOIN nearby n ON n.store_id = p.store_id
  LEFT JOIN deals d ON d.barcode = p.barcode AND d.store_id = p.store_id AND d.dn = 1
),
ranked AS (
  SELECT e.*,
         ROW_NUMBER() OVER (PARTITION BY barcode
                            ORDER BY effective_price ASC, store_id) AS rn,
         COUNT(*) OVER (PARTITION BY barcode) AS store_count,
         MAX(price) OVER (PARTITION BY barcode) AS max_price,
         MIN(effective_unit_price) OVER (PARTITION BY barcode) AS min_unit_price
  FROM effective e
)
SELECT prod.barcode, prod.name, prod.brand, prod.manufacturer,
       prod.unit_qty, prod.unit_of_measure, prod.is_weighted,
       r.store_id AS best_store_id,
       r.effective_price AS best_price,
       r.price AS best_regular_price,
       r.is_promo, r.requires_club, r.promo_end, r.promo_description,
       r.effective_unit_price AS best_unit_price,
       r.store_count, r.max_price, r.min_unit_price,
       r.last_updated, m.rank AS relevance
FROM ranked r
JOIN matched m ON m.barcode = r.barcode
JOIN products prod ON prod.barcode = r.barcode
WHERE r.rn = 1
ORDER BY CASE $sort WHEN 'unit_price' THEN r.effective_unit_price
                    WHEN 'relevance' THEN m.rank
                    ELSE r.effective_price END ASC,
         r.effective_price ASC
LIMIT $limit OFFSET $offset`;

// ---------------- core consumer API ----------------

// The product of this whole project: full-text product search restricted to
// stores near the user, cheapest (promo-aware) first.
app.get('/api/v1/search', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').trim();
    const match = ftsMatch(q);
    if (!match) {
      return res.status(400).json({ success: false, error: 'missing or empty q parameter' });
    }
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radiusKm = Math.min(Math.max(parseFloat(req.query.radius_km) || 10, 0.5), 100);
    const sort = ['cheapest', 'unit_price', 'relevance'].includes(req.query.sort)
      ? req.query.sort : 'cheapest';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const hasLocation = Number.isFinite(lat) && Number.isFinite(lon);
    let stores;
    let distances = null;
    if (hasLocation) {
      const near = await nearbyStores(lat, lon, radiusKm);
      if (!near.length) {
        return res.json({ success: true, count: 0, data: [],
                          message: 'אין חנויות ברדיוס שנבחר' });
      }
      stores = near.map(s => s.id);
      distances = new Map(near.map(s => [s.id, s.distance]));
    } else {
      stores = (await getStores()).map(s => s.id);
    }

    const rows = await all(SEARCH_SQL, {
      $stores: JSON.stringify(stores),
      $match: match,
      $now: nowStamp(),
      $sort: sort,
      $limit: limit,
      $offset: offset,
    });

    await getStores(); // ensure cache for enrichment
    for (const row of rows) {
      const store = storeById(row.best_store_id);
      row.best_store_name = store ? store.name : null;
      row.best_store_chain = store ? store.chain_name : null;
      row.best_store_chain_id = store ? store.chain_id : null;
      row.best_store_city = store ? store.city : null;
      row.best_store_distance_km = distances ? (distances.get(row.best_store_id) ?? null) : null;
    }
    res.json({ success: true, count: rows.length, sort, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Autocomplete: FTS prefix match, deduplicated by product name.
app.get('/api/v1/search/suggest', async (req, res) => {
  try {
    const match = ftsMatch(req.query.q || '');
    if (!match) return res.json({ success: true, count: 0, data: [] });
    const rows = await all(
      `SELECT f.barcode, p.name, p.brand
       FROM products_fts f JOIN products p ON p.barcode = f.barcode
       WHERE products_fts MATCH ? ORDER BY rank LIMIT 40`, [match]);
    const seen = new Set();
    const data = [];
    for (const r of rows) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      data.push(r);
      if (data.length >= 10) break;
    }
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Batch prices for a basket: one round-trip instead of N parallel GETs.
// Includes single-unit deal pricing and the best multi-buy bundle as metadata.
app.post('/api/v1/prices/batch', async (req, res) => {
  try {
    const { barcodes, store_ids: storeIds } = req.body || {};
    if (!Array.isArray(barcodes) || !barcodes.length ||
        !Array.isArray(storeIds) || !storeIds.length) {
      return res.status(400).json({ success: false, error: 'barcodes and store_ids arrays are required' });
    }
    if (barcodes.length > 200 || storeIds.length > 600) {
      return res.status(400).json({ success: false, error: 'limits: 200 barcodes, 600 store_ids' });
    }

    const sql = `
WITH matched AS (SELECT value AS barcode FROM json_each($barcodes)),
nearby AS (SELECT value AS store_id FROM json_each($stores)),
deals AS (${DEALS_CTE}),
multibuy AS (
  SELECT pi.barcode, pr.store_id,
         pi.min_qty AS multibuy_qty, pi.discounted_price AS multibuy_total,
         pr.description AS multibuy_description,
         ROW_NUMBER() OVER (PARTITION BY pi.barcode, pr.store_id
                            ORDER BY pi.discounted_price / pi.min_qty ASC) AS mn
  FROM promotions pr
  JOIN promotion_items pi ON pi.promotion_row_id = pr.id
  WHERE pr.store_id IN (SELECT store_id FROM nearby)
    AND pi.barcode IN (SELECT barcode FROM matched)
    AND pi.discounted_price > 0
    AND COALESCE(pi.min_qty, 1) > 1
    AND COALESCE(pr.start_date, '0') <= $now
    AND COALESCE(pr.end_date, '9') >= $now
)
SELECT p.store_id, p.barcode, p.price, p.unit_price, p.last_updated,
       CASE WHEN d.deal_price IS NOT NULL AND d.deal_price < p.price
            THEN d.deal_price ELSE p.price END AS effective_price,
       CASE WHEN d.deal_price IS NOT NULL AND d.deal_price < p.price
            THEN 1 ELSE 0 END AS is_promo,
       d.requires_club, d.promo_end, d.promo_description,
       mb.multibuy_qty, mb.multibuy_total, mb.multibuy_description
FROM prices p
JOIN matched m ON m.barcode = p.barcode
JOIN nearby n ON n.store_id = p.store_id
LEFT JOIN deals d ON d.barcode = p.barcode AND d.store_id = p.store_id AND d.dn = 1
LEFT JOIN multibuy mb ON mb.barcode = p.barcode AND mb.store_id = p.store_id AND mb.mn = 1`;

    const rows = await all(sql, {
      $barcodes: JSON.stringify(barcodes.map(String)),
      $stores: JSON.stringify(storeIds.map(String)),
      $now: nowStamp(),
    });

    await getStores();
    for (const row of rows) {
      const store = storeById(row.store_id);
      if (store) {
        row.store_name = store.name;
        row.chain_id = store.chain_id;
        row.chain_name = store.chain_name;
        row.city = store.city;
        row.latitude = store.latitude;
        row.longitude = store.longitude;
      }
    }
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Price history for sparklines / "price dropped" signals.
app.get('/api/v1/products/:barcode/history', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
    const params = [req.params.barcode];
    let sql = `SELECT store_id, price, unit_price, changed_at
               FROM price_history WHERE barcode = ?`;
    if (req.query.store_id) {
      sql += ' AND store_id = ?';
      params.push(req.query.store_id);
    }
    sql += ' ORDER BY changed_at DESC LIMIT ?';
    params.push(limit);
    const rows = await all(sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- legacy v1 endpoints (kept compatible) ----------------

app.get('/api/v1/chains', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM chains');
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/stores', async (req, res) => {
  try {
    const { chain_id: chainId } = req.query;
    const rows = chainId
      ? await all('SELECT * FROM stores WHERE chain_id = ?', [chainId])
      : await all('SELECT * FROM stores');
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/products', async (req, res) => {
  try {
    const { query, barcode } = req.query;
    let rows;
    if (barcode) {
      rows = await all('SELECT * FROM products WHERE barcode = ?', [barcode]);
    } else if (query) {
      const wild = `%${query}%`;
      rows = await all(
        'SELECT * FROM products WHERE name LIKE ? OR brand LIKE ? OR barcode LIKE ? LIMIT 500',
        [wild, wild, wild]);
    } else {
      rows = await all('SELECT * FROM products LIMIT 100');
    }
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/prices', async (req, res) => {
  try {
    const { barcode, store_id: storeId } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    let sql = `
      SELECT p.*, s.name AS store_name, s.city, s.address, s.latitude, s.longitude,
             c.name_he AS chain_name, prod.name AS product_name
      FROM prices p
      JOIN stores s ON p.store_id = s.id
      JOIN chains c ON s.chain_id = c.id
      JOIN products prod ON p.barcode = prod.barcode`;
    const conditions = [];
    const params = [];
    if (barcode) { conditions.push('p.barcode = ?'); params.push(barcode); }
    if (storeId) { conditions.push('p.store_id = ?'); params.push(storeId); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = await all(sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/scraper-status', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM scraper_status');
    const totals = await get(
      `SELECT COUNT(*) AS files,
              COALESCE(SUM(row_count), 0) AS rows_ingested
       FROM ingested_files WHERE status = 'done'`);
    const statusMap = {};
    rows.forEach((row) => {
      statusMap[row.chain_id] = {
        status: row.status,
        last_run: row.last_run,
        duration_sec: row.duration_sec,
        files_downloaded: row.files_downloaded,
        size_mb: row.size_mb,
        status_code: row.status_code,
        error: row.error,
      };
    });
    res.json({ success: true, data: statusMap, totals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- scrape orchestration ----------------

const PIPELINE_PYTHON = process.env.PIPELINE_PYTHON
  || path.join(__dirname, '.venv', 'bin', 'python');
let runningScrape = null;

function startScrape(chains, types) {
  const args = ['-m', 'pipeline.run', '--chains', chains,
    '--types', types || 'stores,pricefull,promofull'];
  if (process.env.SCRAPE_FILE_LIMIT) args.push('--limit', process.env.SCRAPE_FILE_LIMIT);
  const child = spawn(PIPELINE_PYTHON, args, {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DB_PATH },
  });
  runningScrape = { chains, startedAt: new Date().toISOString() };
  child.stdout.on('data', (d) => process.stdout.write(`[pipeline] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[pipeline] ${d}`));
  child.on('error', (err) => {
    console.error('[pipeline] failed to start:', err.message);
    runningScrape = null;
  });
  child.on('close', (code) => {
    console.log(`[pipeline] exited with code ${code}`);
    runningScrape = null;
    getStores(true).catch(() => {});
  });
  return child;
}

app.post('/api/v1/trigger-scrape', async (req, res) => {
  try {
    const { chain_id: chainId } = req.body || {};
    if (!chainId) {
      return res.status(400).json({ success: false, error: 'Invalid chain_id' });
    }
    if (chainId !== 'all') {
      const known = await get('SELECT 1 FROM chains WHERE id = ?', [chainId]);
      if (!known) return res.status(400).json({ success: false, error: `Unknown chain: ${chainId}` });
    }
    if (runningScrape) {
      return res.status(409).json({
        success: false,
        error: `Scrape already in progress (${runningScrape.chains}, started ${runningScrape.startedAt})`,
      });
    }
    await run(
      `UPDATE scraper_status SET status = 'running', status_code = 'In Progress', error = NULL
       WHERE chain_id = ? OR ? = 'all'`, [chainId, chainId]);
    startScrape(chainId);
    res.json({ success: true, message: `Scraper triggered for ${chainId}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

if (process.env.ENABLE_CRON === '1') {
  const schedule = process.env.CRON_SCHEDULE || '0 3 * * *';
  cron.schedule(schedule, () => {
    if (runningScrape) {
      console.log('[cron] skipping: scrape already running');
      return;
    }
    console.log('[cron] starting scheduled ingest');
    startScrape(process.env.CHAINS || 'all');
  });
  console.log(`Scheduled ingest enabled: ${schedule}`);
}

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
