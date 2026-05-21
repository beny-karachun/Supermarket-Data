const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to SQLite Database
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err);
  } else {
    console.log('Connected successfully to SQLite database.');
  }
});

// API Endpoints

// 1. Get all chains
app.get('/api/v1/chains', (req, res) => {
  db.all('SELECT * FROM chains', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, count: rows.length, data: rows });
  });
});

// 2. Get all stores (with optional chain filtering)
app.get('/api/v1/stores', (req, res) => {
  const { chain_id } = req.query;
  let sql = 'SELECT * FROM stores';
  const params = [];
  
  if (chain_id) {
    sql += ' WHERE chain_id = ?';
    params.push(chain_id);
  }
  
  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, count: rows.length, data: rows });
  });
});

// 3. Search products in the database
app.get('/api/v1/products', (req, res) => {
  const { query, barcode } = req.query;
  
  if (barcode) {
    db.all('SELECT * FROM products WHERE barcode = ?', [barcode], (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      return res.json({ success: true, count: rows.length, data: rows });
    });
  } else if (query) {
    // Fuzzy matching against name, brand, or barcode
    const sql = 'SELECT * FROM products WHERE name LIKE ? OR brand LIKE ? OR barcode LIKE ?';
    const wild = `%${query}%`;
    db.all(sql, [wild, wild, wild], (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      return res.json({ success: true, count: rows.length, data: rows });
    });
  } else {
    // Return first 100 products if no query specified to avoid massive transfers
    db.all('SELECT * FROM products LIMIT 100', [], (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, count: rows.length, data: rows });
    });
  }
});

// 4. Retrieve prices (enriched with chain, store details)
app.get('/api/v1/prices', (req, res) => {
  const { barcode, store_id } = req.query;
  
  let sql = `
    SELECT p.*, s.name AS store_name, s.city, s.address, s.latitude, s.longitude, c.name_he AS chain_name, prod.name AS product_name
    FROM prices p
    JOIN stores s ON p.store_id = s.id
    JOIN chains c ON s.chain_id = c.id
    JOIN products prod ON p.barcode = prod.barcode
  `;
  const conditions = [];
  const params = [];
  
  if (barcode) {
    conditions.push('p.barcode = ?');
    params.push(barcode);
  }
  if (store_id) {
    conditions.push('p.store_id = ?');
    params.push(store_id);
  }
  
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  
  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, count: rows.length, data: rows });
  });
});

// 5. Retrieve status metrics of crawler tasks
app.get('/api/v1/scraper-status', (req, res) => {
  db.all('SELECT * FROM scraper_status', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    
    // Format rows back as a dictionary for the UI dashboard compatibility
    const statusMap = {};
    rows.forEach(row => {
      statusMap[row.chain_id] = {
        status: row.status,
        last_run: row.last_run,
        duration_sec: row.duration_sec,
        files_downloaded: row.files_downloaded,
        size_mb: row.size_mb,
        status_code: row.status_code,
        error: row.error
      };
    });
    
    res.json({ success: true, data: statusMap });
  });
});

// 6. Trigger crawler scraping session
app.post('/api/v1/trigger-scrape', (req, res) => {
  const { chain_id } = req.body;
  if (!chain_id) {
    return res.status(400).json({ success: false, error: 'Invalid chain_id' });
  }

  // Update status to 'running'
  db.run(
    "UPDATE scraper_status SET status = 'running', status_code = 'In Progress', error = NULL WHERE chain_id = ?",
    [chain_id],
    (err) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }

      // Simulate parsing background work, then update to idle
      setTimeout(() => {
        const lastRun = new Date().toISOString().replace('T', ' ').substr(0, 16);
        db.run(
          `UPDATE scraper_status 
           SET status = 'idle', 
               status_code = 'Success', 
               last_run = ?, 
               files_downloaded = files_downloaded + 2, 
               size_mb = ROUND(size_mb + 4.5, 1) 
           WHERE chain_id = ?`,
          [lastRun, chain_id]
        );
      }, 5000);

      res.json({ success: true, message: `Scraper triggered for ${chain_id}` });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
