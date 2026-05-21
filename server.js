const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mock Database
const chains = [
  { id: 'shufersal', name_he: 'שופרסל', logo_url: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=100&auto=format&fit=crop&q=60&ixlib=rb-4.0.3', base_url: 'http://prices.shufersal.co.il', auth_type: 'None' },
  { id: 'rami_levy', name_he: 'רמי לוי', logo_url: 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=100&auto=format&fit=crop&q=60&ixlib=rb-4.0.3', base_url: 'https://url.retail.rami-levy.co.il', auth_type: 'None' },
  { id: 'yohananof', name_he: 'יוחננוף', logo_url: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=100&auto=format&fit=crop&q=60&ixlib=rb-4.0.3', base_url: 'https://yohananof.co.il/prices', auth_type: 'Cerberus Portal' },
  { id: 'victory', name_he: 'ויקטורי', logo_url: 'https://images.unsplash.com/photo-1534723452862-4c874018d66d?w=100&auto=format&fit=crop&q=60&ixlib=rb-4.0.3', base_url: 'http://victoryprices.co.il', auth_type: 'Credentials Required' },
  { id: 'tiv_taam', name_he: 'טיב טעם', logo_url: 'https://images.unsplash.com/photo-1583258292688-d0213df4a3a8?w=100&auto=format&fit=crop&q=60&ixlib=rb-4.0.3', base_url: 'http://tivtaam.co.il/prices', auth_type: 'None' }
];

const stores = [
  { id: 'shufersal_123', chain_id: 'shufersal', store_id: '123', name: 'שופרסל דיל תל אביב (דיזנגוף)', address: 'דיזנגוף 50', city: 'תל אביב', latitude: 32.0782, longitude: 34.7741 },
  { id: 'shufersal_456', chain_id: 'shufersal', store_id: '456', name: 'שופרsl שלי ירושלים', address: 'עזה 22', city: 'ירושלים', latitude: 31.7719, longitude: 35.2170 },
  { id: 'rami_levy_10', chain_id: 'rami_levy', store_id: '10', name: 'רמי לוי תלפיות', address: 'פייר קניג 26', city: 'ירושלים', latitude: 31.7513, longitude: 35.2144 },
  { id: 'rami_levy_25', chain_id: 'rami_levy', store_id: '25', name: 'רמי לוי רמת גן (קניון איילון)', address: 'אבא הלל 301', city: 'רמת גן', latitude: 32.0998, longitude: 34.8262 },
  { id: 'yohananof_5', chain_id: 'yohananof', store_id: '5', name: 'יוחננוף רחובות', address: 'מוטי קינד 2', city: 'רחובות', latitude: 31.9056, longitude: 34.8083 },
  { id: 'victory_14', chain_id: 'victory', store_id: '14', name: 'ויקטורי חיפה', address: 'הנביאים 18', city: 'חיפה', latitude: 32.8091, longitude: 34.9968 }
];

const products = [
  { barcode: '7290000042420', name: 'קוטג\' תנובה 5% 250 גרם', manufacturer: 'תנובה', brand: 'תנובה', unit_qty: 250, unit_of_measure: 'גרם', is_weighted: false },
  { barcode: '7290000042437', name: 'קוטג\' תנובה 5% 500 גרם (גביע גדול)', manufacturer: 'תנובה', brand: 'תנובה', unit_qty: 500, unit_of_measure: 'גרם', is_weighted: false },
  { barcode: '7290004130086', name: 'קוטג\' טרה 5% 250 גרם', manufacturer: 'טרה', brand: 'טרה', unit_qty: 250, unit_of_measure: 'גרם', is_weighted: false },
  { barcode: '7290013919023', name: 'מילקי שטראוס שוקולד עם קצפת', manufacturer: 'שטראוס', brand: 'מילקי', unit_qty: 133, unit_of_measure: 'גרם', is_weighted: false },
  { barcode: '7290000155021', name: 'קפה נמס עלית 200 גרם', manufacturer: 'שטראוס עלית', brand: 'עלית', unit_qty: 200, unit_of_measure: 'גרם', is_weighted: false },
  { barcode: '7290000373462', name: 'קטשופ היינץ 700 גרם', manufacturer: 'היינץ', brand: 'היינץ', unit_qty: 700, unit_of_measure: 'גרם', is_weighted: false },
  { barcode: '7290000066110', name: 'במבה אסם 80 גרם', manufacturer: 'אסם', brand: 'במבה', unit_qty: 80, unit_of_measure: 'גרם', is_weighted: false },
  { barcode: '7290000358322', name: 'פסטה אסם פפיון 500 גרם', manufacturer: 'אסם', brand: 'אסם', unit_qty: 500, unit_of_measure: 'גרם', is_weighted: false },
  { barcode: '7290112490102', name: 'שמן קנולה מזוכך 1 ליטר שופרסל', manufacturer: 'שופרסל', brand: 'שופרסל', unit_qty: 1, unit_of_measure: 'ליטר', is_weighted: false }
];

const prices = [
  // Cottage Cheese 250g
  { store_id: 'shufersal_123', barcode: '7290000042420', price: 5.90, unit_price: 2.36, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'shufersal_456', barcode: '7290000042420', price: 5.90, unit_price: 2.36, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'rami_levy_10', barcode: '7290000042420', price: 5.40, unit_price: 2.16, last_updated: '2026-05-21T01:30:00Z' },
  { store_id: 'rami_levy_25', barcode: '7290000042420', price: 5.40, unit_price: 2.16, last_updated: '2026-05-21T01:30:00Z' },
  { store_id: 'yohananof_5', barcode: '7290000042420', price: 5.50, unit_price: 2.20, last_updated: '2026-05-21T03:00:00Z' },
  { store_id: 'victory_14', barcode: '7290000042420', price: 5.80, unit_price: 2.32, last_updated: '2026-05-21T02:15:00Z' },

  // Cottage Cheese 500g (Tnuva)
  { store_id: 'shufersal_123', barcode: '7290000042437', price: 9.80, unit_price: 1.96, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'shufersal_456', barcode: '7290000042437', price: 9.80, unit_price: 1.96, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'rami_levy_10', barcode: '7290000042437', price: 8.90, unit_price: 1.78, last_updated: '2026-05-21T01:30:00Z' },
  { store_id: 'rami_levy_25', barcode: '7290000042437', price: 8.90, unit_price: 1.78, last_updated: '2026-05-21T01:30:00Z' },
  { store_id: 'yohananof_5', barcode: '7290000042437', price: 9.20, unit_price: 1.84, last_updated: '2026-05-21T03:00:00Z' },
  { store_id: 'victory_14', barcode: '7290000042437', price: 9.50, unit_price: 1.90, last_updated: '2026-05-21T02:15:00Z' },

  // Cottage Cheese 250g (Tara)
  { store_id: 'shufersal_123', barcode: '7290004130086', price: 5.70, unit_price: 2.28, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'shufersal_456', barcode: '7290004130086', price: 5.70, unit_price: 2.28, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'rami_levy_10', barcode: '7290004130086', price: 5.20, unit_price: 2.08, last_updated: '2026-05-21T01:30:00Z' },
  { store_id: 'rami_levy_25', barcode: '7290004130086', price: 5.20, unit_price: 2.08, last_updated: '2026-05-21T01:30:00Z' },
  { store_id: 'yohananof_5', barcode: '7290004130086', price: 5.30, unit_price: 2.12, last_updated: '2026-05-21T03:00:00Z' },
  { store_id: 'victory_14', barcode: '7290004130086', price: 5.50, unit_price: 2.20, last_updated: '2026-05-21T02:15:00Z' },

  // Milky
  { store_id: 'shufersal_123', barcode: '7290013919023', price: 2.90, unit_price: 2.18, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'rami_levy_10', barcode: '7290013919023', price: 2.60, unit_price: 1.95, last_updated: '2026-05-21T01:30:00Z' },
  { store_id: 'yohananof_5', barcode: '7290013919023', price: 2.70, unit_price: 2.03, last_updated: '2026-05-21T03:00:00Z' },

  // Instant Coffee
  { store_id: 'shufersal_123', barcode: '7290000155021', price: 16.90, unit_price: 8.45, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'rami_levy_10', barcode: '7290000155021', price: 14.90, unit_price: 7.45, last_updated: '2026-05-21T01:30:00Z' },
  { store_id: 'victory_14', barcode: '7290000155021', price: 15.90, unit_price: 7.95, last_updated: '2026-05-21T02:15:00Z' },

  // Heinz Ketchup
  { store_id: 'shufersal_123', barcode: '7290000373462', price: 12.90, unit_price: 1.84, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'rami_levy_10', barcode: '7290000373462', price: 9.90, unit_price: 1.41, last_updated: '2026-05-21T01:30:00Z' },
  { store_id: 'yohananof_5', barcode: '7290000373462', price: 10.90, unit_price: 1.56, last_updated: '2026-05-21T03:00:00Z' },

  // Bamba
  { store_id: 'shufersal_123', barcode: '7290000066110', price: 4.50, unit_price: 5.62, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'shufersal_456', barcode: '7290000066110', price: 4.50, unit_price: 5.62, last_updated: '2026-05-21T02:00:00Z' },
  { store_id: 'rami_levy_10', barcode: '7290000066110', price: 3.90, unit_price: 4.88, last_updated: '2026-05-21T01:30:00Z' },
  { store_id: 'rami_levy_25', barcode: '7290000066110', price: 3.90, unit_price: 4.88, last_updated: '2026-05-21T01:30:00Z' }
];

const scraperStatus = {
  shufersal: { status: 'idle', last_run: '2026-05-21T02:14:10Z', duration_sec: 142, files_downloaded: 4, size_mb: 52.4, status_code: 'Success', error: null },
  rami_levy: { status: 'idle', last_run: '2026-05-21T01:45:30Z', duration_sec: 210, files_downloaded: 6, size_mb: 78.1, status_code: 'Success', error: null },
  yohananof: { status: 'idle', last_run: '2026-05-21T03:05:00Z', duration_sec: 94, files_downloaded: 2, size_mb: 18.5, status_code: 'Success', error: null },
  victory: { status: 'error', last_run: '2026-05-21T00:30:15Z', duration_sec: 35, files_downloaded: 0, size_mb: 0, status_code: 'Failed', error: 'HTTP 403 Forbidden: IP rate limit exceeded' },
  tiv_taam: { status: 'running', last_run: 'Running now...', duration_sec: 0, files_downloaded: 1, size_mb: 12.3, status_code: 'In Progress', error: null }
};

// API Endpoints
app.get('/api/v1/chains', (req, res) => {
  res.json({ success: true, count: chains.length, data: chains });
});

app.get('/api/v1/stores', (req, res) => {
  const { chain_id } = req.query;
  const filteredStores = chain_id ? stores.filter(s => s.chain_id === chain_id) : stores;
  res.json({ success: true, count: filteredStores.length, data: filteredStores });
});

app.get('/api/v1/products', (req, res) => {
  const { query, barcode } = req.query;
  if (barcode) {
    const product = products.find(p => p.barcode === barcode);
    return res.json({ success: true, data: product ? [product] : [] });
  }
  if (query) {
    const filtered = products.filter(p => 
      p.name.includes(query) || 
      p.brand.includes(query) || 
      p.barcode.includes(query)
    );
    return res.json({ success: true, count: filtered.length, data: filtered });
  }
  res.json({ success: true, count: products.length, data: products });
});

app.get('/api/v1/prices', (req, res) => {
  const { barcode, store_id } = req.query;
  let filtered = prices;
  if (barcode) filtered = filtered.filter(p => p.barcode === barcode);
  if (store_id) filtered = filtered.filter(p => p.store_id === store_id);
  
  // Enrich response with store name and chain info
  const enriched = filtered.map(p => {
    const store = stores.find(s => s.id === p.store_id);
    const chain = store ? chains.find(c => c.id === store.chain_id) : null;
    const product = products.find(prod => prod.barcode === p.barcode);
    return {
      ...p,
      store_name: store ? store.name : 'Unknown',
      chain_name: chain ? chain.name_he : 'Unknown',
      product_name: product ? product.name : 'Unknown'
    };
  });
  
  res.json({ success: true, count: enriched.length, data: enriched });
});

app.get('/api/v1/scraper-status', (req, res) => {
  res.json({ success: true, data: scraperStatus });
});

app.post('/api/v1/trigger-scrape', (req, res) => {
  const { chain_id } = req.body;
  if (!chain_id || !scraperStatus[chain_id]) {
    return res.status(400).json({ success: false, error: 'Invalid chain_id' });
  }
  
  // Trigger mock scraping
  scraperStatus[chain_id].status = 'running';
  scraperStatus[chain_id].status_code = 'In Progress';
  scraperStatus[chain_id].error = null;

  setTimeout(() => {
    scraperStatus[chain_id].status = 'idle';
    scraperStatus[chain_id].status_code = 'Success';
    scraperStatus[chain_id].last_run = new Date().toISOString();
    scraperStatus[chain_id].files_downloaded += 2;
    scraperStatus[chain_id].size_mb = parseFloat((scraperStatus[chain_id].size_mb + 4.5).toFixed(1));
  }, 5000);

  res.json({ success: true, message: `Scraper triggered for ${chain_id}` });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
