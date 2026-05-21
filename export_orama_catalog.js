const { create, insert, save, search } = require('@orama/orama');
const fs = require('fs');
const path = require('path');

// Master product list (Israeli supermarket data catalog)
const products = [
  { barcode: '7290000042420', name: "קוטג' תנובה 5% 250 גרם", manufacturer: 'תנובה', brand: 'תנובה' },
  { barcode: '729013919023', name: 'מילקי שטראוס שוקולד עם קצפת', manufacturer: 'שטראוס', brand: 'מילקי' },
  { barcode: '7290000155021', name: 'קפה נמס עלית 200 גרם', manufacturer: 'שטראוס עלית', brand: 'עלית' },
  { barcode: '7290000373462', name: 'קטשופ היינץ 700 גרם', manufacturer: 'היינץ', brand: 'היינץ' },
  { barcode: '7290000066110', name: 'במבה אסם 80 גרם', manufacturer: 'אסם', brand: 'במבה' },
  { barcode: '7290000358322', name: 'פסטה אסם פפיון 500 גרם', manufacturer: 'אסם', brand: 'אסם' },
  { barcode: '7290112490102', name: 'שמן קנולה מזוכך 1 ליטר שופרסל', manufacturer: 'שופרסל', brand: 'שופרסל' }
];

// Hebrew-aware tokenizer
const hebrewTokenizer = {
  tokenize: (raw, language, prop) => {
    if (typeof raw !== 'string') return [];
    
    // Normalize string:
    // 1. Lowercase
    // 2. Remove Hebrew quotes (גרש ׳, גרשיים ״) and English quotes to match both 'קוטג' and 'קוטג'
    // 3. Keep alphanumeric English characters (\w), spaces, and Hebrew unicode block (\u0590-\u05fe)
    const normalized = raw.toLowerCase()
      .replace(/[\'\`\"\״\׳]/g, '')
      .replace(/[^\w\s\u0590-\u05fe]/g, ' ');
    
    return normalized.split(/\s+/).filter(Boolean);
  }
};

async function run() {
  console.log('--- אתחול מאגר Orama עם Tokenizer בעברית ---');
  
  // Create Orama database with schema and custom Hebrew tokenizer
  const db = await create({
    schema: {
      barcode: 'string',
      name: 'string',
      manufacturer: 'string',
      brand: 'string'
    },
    components: {
      tokenizer: hebrewTokenizer
    }
  });

  // Insert documents
  console.log(`מכניס ${products.length} מוצרים למאגר...`);
  for (const product of products) {
    await insert(db, product);
  }
  console.log('ההכנסה הושלמה בהצלחה!');

  // Serialize and save the index to disk
  console.log('\n--- ייצוא המאגר לקובץ JSON ---');
  const serialized = await save(db);
  const outputPath = path.join(__dirname, 'public', 'orama_catalog.json');
  
  // Ensure the public directory exists
  if (!fs.existsSync(path.join(__dirname, 'public'))) {
    fs.mkdirSync(path.join(__dirname, 'public'));
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(serialized, null, 2), 'utf8');
  console.log(`מאגר Orama מיוצא נשמר בכתובת: ${outputPath}`);

  // Run Test Search Queries
  console.log('\n--- בדיקת חיפושים ב-Orama (Fuzzy Search) ---');
  
  const testQueries = [
    'קוטג תנובה',       // Typo (missing single quote)
    'במבה 80',          // Full-text match
    'קנולה שופרסל',     // Reordered query
    'שטראוס מילקי'       // Manufacturer + brand search
  ];

  for (const q of testQueries) {
    console.log(`\nשאילתה: "${q}"`);
    const results = await search(db, {
      term: q,
      properties: ['name', 'manufacturer', 'brand'],
      tolerance: 1 // Match with up to 1 character variance
    });

    if (results.count > 0) {
      console.log(`נמצאו ${results.count} תוצאות:`);
      results.hits.forEach((hit, idx) => {
        console.log(`  ${idx + 1}. [ברקוד: ${hit.document.barcode}] ${hit.document.name} (ציון התאמה: ${hit.score.toFixed(4)})`);
      });
    } else {
      console.log('לא נמצאו תוצאות.');
    }
  }
}

run().catch(console.error);
