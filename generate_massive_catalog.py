import sqlite3
import random
import os
import time

DB_PATH = os.path.join(os.path.dirname(__file__), 'database.db')

def generate_catalog():
    print("Connecting to SQLite database...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Clean existing tables first
    print("Clearing old products and prices...")
    cursor.execute("DELETE FROM prices")
    cursor.execute("DELETE FROM products")
    
    # 2. Define category generation templates
    categories_templates = {
        'Dairy': {
            'brands': ['תנובה', 'טרה', 'שטראוס', 'גבינות גד', 'יוטבתה', 'שופרסל', 'רמי לוי'],
            'manufacturers': ['תנובה', 'טרה', 'שטראוס', 'גד', 'שטראוס', 'שופרסל', 'רמי לוי'],
            'items': [
                ('חלב {}% {} ליטר קרטון', [('1%', '1'), ('3%', '1'), ('3%', '2'), ('1%', '2')], 5.50, 'ליטר'),
                ('חלב {}% {} ליטר בקבוק', [('3%', '1.5'), ('1%', '1.5'), ('3%', '2')], 7.80, 'ליטר'),
                ('קוטג\' {} {}% {} גרם', [('תנובה', '5', '250'), ('תנובה', '9', '250'), ('טרה', '5', '250'), ('שטראוס', '5', '250'), ('טרה', '9', '250')], 5.90, 'גרם'),
                ('גבינה לבנה {}% {} גרם', [('5', '250'), ('9', '250'), ('5', '500'), ('9', '500')], 5.80, 'גרם'),
                ('גבינת עמק פרוסה {}% {} גרם', [('28', '200'), ('15', '200'), ('28', '400'), ('15', '400')], 13.90, 'גרם'),
                ('חמאה {} {} גרם', [('תנובה', '200'), ('טרה', '200'), ('מיובאת', '200')], 8.50, 'גרם'),
                ('יוגורט דנונה {} {} גרם', [('טבעי 1.5%', '200'), ('טבעי 3%', '200'), ('תות 3%', '150'), ('אפרסק 3%', '150')], 3.80, 'גרם'),
                ('מילקי שוקולד {}', [('עם קצפת',), ('מיני',), ('עם פצפוצים',)], 3.10, 'גרם'),
                ('שוקו {} {} ליטר קרטון', [('יוטבתה', '1'), ('טרה', '1'), ('יוטבתה', '0.5')], 9.90, 'ליטר'),
                ('שמנת חמוצה {}% {} מ"ל', [('15', '200'), ('9', '200'), ('27', '200')], 2.50, 'מ"ל')
            ]
        },
        'Bakery': {
            'brands': ['אנג\'ל', 'ברמן', 'דוידוביץ\'', 'שופרסל', 'רמי לוי'],
            'manufacturers': ['אנג\'ל', 'ברמן', 'דוידוביץ\'', 'שופרסל', 'רמי לוי'],
            'items': [
                ('לחם אחיד {} {} גרם', [('פרוס', '750'), ('שלם', '750')], 7.10, 'גרם'),
                ('לחם חיטה מלאה {} {} גרם', [('פרוס', '750'), ('שלם', '750')], 12.50, 'גרם'),
                ('פיתות כוסמין {} יחידות', [('5',), ('10',)], 14.90, 'יחידות'),
                ('לחמניות המבורגר {} יחידות', [('6',), ('8',)], 8.90, 'יחידות'),
                ('פיתות אנג\'ל {} יחידות', [('5',), ('10',)], 9.90, 'יחידות'),
                ('חלה לשבת מובחרת {} גרם', [('500',), ('700',)], 8.00, 'גרם')
            ]
        },
        'Produce': {
            'brands': ['חקלאי ישיר', 'שוק מקומי', 'כרמל', 'שופרסל מותג'],
            'manufacturers': ['חקלאי ישיר', 'חקלאות מקומית', 'כרמל', 'שופרסל'],
            'items': [
                ('עגבניות {} טריות ק"ג', [('חממה',), ('שרי',), ('בלאדי',)], 6.90, 'ק"ג'),
                ('מלפפון {} מובחר ק"ג', [('חממה',), ('בלאדי',)], 5.90, 'ק"ג'),
                ('תפוח עץ {} ק"ג', [('פינק ליידי',), ('חרמון',), ('זהוב',)], 11.90, 'ק"ג'),
                ('בננות מובחרות {} ק"ג', [('ארוזות',), ('בתפזורת',)], 8.90, 'ק"ג'),
                ('בצל {} יבש ק"ג', [('צהוב',), ('אדום',)], 4.90, 'ק"ג'),
                ('תפוח אדמה {} ארוז ק"ג', [('לבן',), ('אדום',)], 6.50, 'ק"ג')
            ]
        },
        'Pantry': {
            'brands': ['אסם', 'סוגת', 'תלמה', 'מאסטר שף', 'היינץ', 'סטרקיסט', 'יד מרדכי', 'שופרסל', 'רמי לוי'],
            'manufacturers': ['אסם', 'סוגת', 'יוניליוור', 'שסטוביץ', 'היינץ', 'סטרקיסט', 'יד מרדכי', 'שופרסל', 'רמי לוי'],
            'items': [
                ('פסטה {} 500 גרם', [('ספגטי',), ('פפיון',), ('פליני',), ('פנה',), ('ברגים',)], 4.50, 'גרם'),
                ('אורז {} 1 ק"ג', [('פרסי קלאסי',), ('בסמטי',), ('יסמין',), ('עגול',)], 8.50, 'גרם'),
                ('שמן קנולה {} 1 ליטר', [('מזוכך',), ('מזוכך שופרסל',), ('רמי לוי',)], 7.90, 'ליטר'),
                ('שמן זית {} 750 מ"ל', [('כתית מעולה יד מרדכי',), ('כתית מעולה שופרסל',), ('רמי לוי כתית',)], 34.90, 'מ"ל'),
                ('טונה סטרקיסט {} 4 יחידות', [('בשמן קנולה',), ('במים',), ('בשמן זית',)], 21.90, 'גרם'),
                ('רסק עגבניות {} {} גרם', [('טל', '400'), ('טל', '100'), ('השף', '400')], 3.90, 'גרם'),
                ('מיונז {} {} מ"ל', [('הלמנס אמיתי', '400'), ('הלמנס לייט', '400'), ('אסם אמיתי', '400')], 13.90, 'מ"ל'),
                ('סוכר לבן {} 1 ק"ג', [('סוגת',), ('רמי לוי',), ('שופרסל',)], 3.80, 'גרם'),
                ('מלח {} {}', [('שולחן דק סוגת', '1 ק"ג'), ('ים אטלנטי גס מלח הארץ', '1 ק"ג'), ('שולחן מועשר ביוד מלח הארץ', '250 גרם'), ('הימלאיה ורוד דק שופרסל', '500 גרם'), ('ים אטלנטי דק מטחנה מלח הארץ', '110 גרם')], 3.50, 'גרם'),
                ('קטשופ אסם {} {} גרם', [('קלאסי', '750'), ('חריף', '750'), ('ללא סוכר', '750')], 10.50, 'גרם')
            ]
        },
        'Drinks': {
            'brands': ['קוקה קולה', 'פריגת', 'נביעות', 'מי עדן', 'טמפו', 'שופרסל', 'רמי לוי'],
            'manufacturers': ['החברה המרכזית', 'פריגת', 'נביעות', 'מי עדן', 'טמפו', 'שופרסל', 'רמי לוי'],
            'items': [
                ('קוקה קולה {} 1.5 ליטר', [('קלאסי',), ('זירו',), ('דיאט',)], 6.90, 'ליטר'),
                ('מיץ {} פריגת 1.5 ליטר', [('תפוזים',), ('ענבים',), ('אשכוליות',), ('לימונדה',)], 12.90, 'ליטר'),
                ('מים מינרליים {} 6x1.5 ליטר', [('נביעות',), ('מי עדן',)], 12.50, 'ליטר'),
                ('סודה טמפו {} 1.5 ליטר', [('רגילה',), ('בטעם לימון',)], 4.20, 'ליטר'),
                ('בירה {} 6 בקבוקים', [('גולדסטאר',), ('מכבי',), ('הייניקן',)], 35.00, 'ליטר')
            ]
        },
        'Snacks': {
            'brands': ['אסם', 'עלית', 'דוריתוס', 'תפוצ\'יפס', 'כרמית'],
            'manufacturers': ['אסם', 'שטראוס עלית', 'שטראוס', 'שטראוס', 'כרמית'],
            'items': [
                ('במבה אסם {} {} גרם', [('קלאסי', '80'), ('קטן', '25'), ('נוגט', '80'), ('חלבה', '80')], 4.50, 'גרם'),
                ('ביסלי אסם {} {} גרם', [('גריל', '70'), ('בצל', '70'), ('פלאפל', '70'), ('פיצה', '70')], 4.20, 'גרם'),
                ('תפוצ\'יפס {} {} גרם', [('קלאסי', '50'), ('ברביקיו', '50'), ('חמוץ חריף', '50')], 4.90, 'גרם'),
                ('שוקולד פרה {} {} גרם', [('חלב', '100'), ('מריר', '100'), ('לבן', '100'), ('עם סוכריות קופצות', '100')], 5.50, 'גרם'),
                ('ופל שוקולד {} {} גרם', [('עלית ללא סוכר', '200'), ('אסם ללא גלוטן', '200'), ('עלית למיניהם', '200')], 6.90, 'גרם')
            ]
        },
        'Hygiene': {
            'brands': ['פיירי', 'אריאל', 'לילי', 'פלמוליב', 'קולגייט', 'הד אנד שולדרס', 'פינוק', 'סנו מקסימה'],
            'manufacturers': ['פרוקטר אנד גמבל', 'פרוקטר אנד גמבל', 'חוגלה קימברלי', 'קולגייט פלמוליב', 'קולגייט פלמוליב', 'פרוקטר אנד גמבל', 'יוניליוור', 'סנו'],
            'items': [
                ('נוזל כלים פיירי {} {} מ"ל', [('לימון', '750'), ('תפוח', '750'), ('עור רגיש', '750')], 9.90, 'מ"ל'),
                ('אבקת כביסה אריאל {} {} ק"ג', [('קלאסי', '3'), ('לצבעוני', '3')], 29.90, 'גרם'),
                ('נייר טואלט לילי {} גלילים', [('30',), ('40',)], 36.90, 'יחידות'),
                ('סבון נוזלי לידיים פלמוליב {} {} מ"ל', [('קלאסי', '500'), ('דבש וחלב', '500'), ('אלוורה', '500')], 8.90, 'מ"ל'),
                ('משחת שיניים קולגייט {} {} מ"ל', [('אופטיק וויט', '75'), ('טריפל אקשן', '100'), ('מקס פרש', '100')], 12.90, 'מ"ל'),
                ('שמפו {} {} {} מ"ל', [('הד אנד שולדרס קלאסי', '500', 'שמפו'), ('פינוק לשיער רגיל', '700', 'פינוק'), ('פינוק מרכך', '700', 'פינוק')], 17.90, 'מ"ל'),
                ('מרכך כביסה סנו מקסימה {} {} ליטר', [('פרחי בר', '2'), ('סנסטיב', '2'), ('אולטרה', '2')], 16.90, 'ליטר')
            ]
        }
    }

    # 3. Create active stores coordinates and chains dictionary
    # Query stores to mapping their IDs and chain factors
    cursor.execute("SELECT id, chain_id FROM stores")
    stores = cursor.fetchall()
    print(f"Loaded {len(stores)} store locations from database.")

    chain_price_factors = {
        'rami_levy': 0.90,
        'yohananof': 0.94,
        'victory': 0.96,
        'shufersal': 1.00,
        'tiv_taam': 1.08
    }

    products_batch = []
    prices_batch = []
    
    barcode_counter = 7290000000000
    seen_names = set()
    
    sub_brands_pool = {
        'Dairy': ['במרקם שמנת', 'מועשר בסידן', 'ללא לקטוז', 'דל לקטוז', 'קל', 'קלאסי', 'אורגני', 'עיזים', 'מקומי', 'בטעם עדיn'],
        'Bakery': ['כפרי', 'מחמצת', 'מלא', 'מחיטה מלאה', 'קל', 'פרוס דק', 'בסגנון איטלקי', 'עם שומשום', 'ללא גלוטן', 'מסורתי'],
        'Produce': ['אורגני', 'מובחר', 'איכות פרימיום', 'טרי מהשדה', 'בלאדי', 'חממה', 'בעונה', 'ללא ריסוס', 'לסלט', 'מבוקר'],
        'Pantry': ['כתית מעולה', 'בכבישה קרה', 'מיובא', 'ללא סוכר', 'ללא גלוטן', 'אורגני', 'מארז חיסכון', 'מסורתי', 'בטעם עשיר', 'מבושל'],
        'Drinks': ['קלאסי', 'דיאט', 'זירו', 'סחוט טבעי', 'ללא סוכר', 'מועז', 'בטעם פירות', 'קפוא', 'ללא גזים', 'עדין'],
        'Snacks': ['נוגט', 'חלבה', 'חריף', 'מתוק', 'מלוח', 'במארז משפחתי', 'פריך', 'מריר', 'חלב', 'ללא גלוטן'],
        'Hygiene': ['לימון', 'תפוח', 'אלוורה', 'לבושם עדין', 'למניעת קשקשים', 'עם לחות', 'סנסיטיב', 'קלאסיק', 'פרחי בר', 'רענן']
    }

    suffixes_pool = [
        '', '', '', '', '', 
        '(מארז זוג)', '(אריזה משפחתית)', '(מהדורה מוגבלת)', '(אריזת חיסכון)',
        '(חדש!)', '(סדרה מיוחדת)', '(אריזה אישית)', '(ייצור מיוחד)'
    ]
    
    print("Programmatically generating 12,000+ products...")
    
    t0 = time.time()
    
    for category, meta in categories_templates.items():
        # Generate variations for each item template to achieve large catalog scale
        for template_str, variations, ref_price, unit in meta['items']:
            # We want about 1,500 to 2,000 products per template to hit 12,000+ total
            # Let's generate a loop that creates unique permutations
            for i in range(180): # Generates 180 product variations per template
                for var_tuple in variations:
                    barcode_counter += 1
                    barcode = str(barcode_counter)
                    
                    brand = random.choice(meta['brands'])
                    mfg = random.choice(meta['manufacturers'])
                    
                    # Fill placeholder in name
                    try:
                        if len(var_tuple) == 1:
                            item_name = template_str.format(var_tuple[0])
                        elif len(var_tuple) == 2:
                            item_name = template_str.format(var_tuple[0], var_tuple[1])
                        elif len(var_tuple) == 3:
                            item_name = template_str.format(var_tuple[0], var_tuple[1], var_tuple[2])
                        else:
                            item_name = template_str
                    except:
                        item_name = template_str
                        
                    # Add unique details to name using descriptive sub-brands and suffixes
                    desc = random.choice(sub_brands_pool.get(category, ['קלאסי']))
                    suffix = random.choice(suffixes_pool)
                    
                    if desc not in item_name:
                        for u in [' גרם', ' ליטר', ' מ"ל', ' יחידות', ' ק"ג']:
                            if u in item_name:
                                item_name = item_name.replace(u, f"{u} {desc}")
                                break
                        else:
                            item_name = f"{item_name} {desc}"
                            
                    if suffix:
                        item_name = f"{item_name} {suffix}"
                        
                    if item_name in seen_names:
                        item_name = f"{item_name} (סדרה {i+1})"
                    
                    seen_names.add(item_name)
                    
                    # Quantity
                    qty = 1.0
                    parsed_qty = False
                    
                    if len(var_tuple) >= 1:
                        val = var_tuple[-1]
                        cleaned_val = val.replace(' ק"ג', '').replace(' גרם', '').replace(' מ"ל', '').replace(' ליטר', '').replace(' יחידות', '').strip()
                        try:
                            qty = float(cleaned_val)
                            parsed_qty = True
                        except ValueError:
                            pass
                    
                    if not parsed_qty:
                        for val in reversed(var_tuple):
                            cleaned_val = val.replace(' ק"ג', '').replace(' גרם', '').replace(' מ"ל', '').replace(' ליטר', '').replace(' יחידות', '').strip()
                            try:
                                qty = float(cleaned_val)
                                parsed_qty = True
                                break
                            except ValueError:
                                pass
                                
                    products_batch.append((barcode, item_name, mfg, brand, qty, unit, 0))
                    
                    # Sample about 15% of all stores in Israel to carry this specific product
                    num_carrying = max(5, int(len(stores) * random.uniform(0.12, 0.18)))
                    carrying_stores = random.sample(stores, k=num_carrying)
                    
                    for store_id, chain_id in carrying_stores:
                        factor = chain_price_factors.get(chain_id, 1.0)
                        noise = random.uniform(0.97, 1.03)
                        store_price = round(ref_price * factor * noise, 2)
                        
                        # Calculate unit price
                        if qty > 0:
                            if unit in ['גרם', 'מ"ל']:
                                unit_price = round(store_price / (qty / 100.0), 2)
                            else:
                                unit_price = round(store_price / qty, 2)
                        else:
                            unit_price = store_price
                            
                        prices_batch.append((store_id, barcode, store_price, unit_price, '2026-05-21 14:00'))

    # Bulk insert products
    print(f"Upserting {len(products_batch)} products in SQLite...")
    cursor.executemany("""
        INSERT INTO products (barcode, name, manufacturer, brand, unit_qty, unit_of_measure, is_weighted)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, products_batch)
    
    # Bulk insert prices in chunks of 50,000 to keep transactions clean
    print(f"Upserting {len(prices_batch)} store prices in SQLite...")
    chunk_size = 50000
    for chunk_start in range(0, len(prices_batch), chunk_size):
        chunk = prices_batch[chunk_start:chunk_start+chunk_size]
        cursor.executemany("""
            INSERT INTO prices (store_id, barcode, price, unit_price, last_updated)
            VALUES (?, ?, ?, ?, ?)
        """, chunk)
        
    conn.commit()

    print("Rebuilding product search index...")
    from pipeline.db import rebuild_fts
    rebuild_fts(conn)
    conn.close()

    t_elapsed = time.time() - t0
    print(f"Seeding completed successfully in {t_elapsed:.2f} seconds.")
    print(f"Total Products Seeded: {len(products_batch)}")
    print(f"Total Store Prices Seeded: {len(prices_batch)}")

if __name__ == '__main__':
    import sys
    if '--demo' not in sys.argv:
        print('This script generates SYNTHETIC catalog data on top of an existing demo DB.')
        print('Re-run with --demo to confirm: python generate_massive_catalog.py --demo')
        sys.exit(1)
    generate_catalog()
