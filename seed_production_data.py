"""Seeds SYNTHETIC demo data into a FRESH database (5 chains, ~570 stores,
demo products/prices/promotions). Real data comes from `python -m pipeline.run`
— never mix the two. Requires the --demo flag as confirmation.
"""
import argparse
import random
import sys
from datetime import datetime, timedelta

from pipeline.db import get_conn, rebuild_fts
from pipeline.migrate import migrate


def seed_database(db_path=None):
    migrate(db_path)
    conn = get_conn(db_path)
    cursor = conn.cursor()

    existing = cursor.execute('SELECT count(*) FROM products').fetchone()[0]
    if existing:
        print(f'Refusing to seed: database already contains {existing} products.')
        print('Demo data is for fresh databases only (pass --db <new path>).')
        conn.close()
        sys.exit(1)

    print('Seeding synthetic demo data...')

    # Chain identity (names/colors) comes from pipeline/config.py via migrate;
    # this only fills the legacy demo-portal fields for the 5 original chains.
    chains_demo_meta = [
        ('shufersal', 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=100', 'http://prices.shufersal.co.il', 'None'),
        ('rami_levy', 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=100', 'https://url.retail.rami-levy.co.il', 'None'),
        ('yohananof', 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=100', 'https://yohananof.co.il/prices', 'Cerberus Portal'),
        ('victory', 'https://images.unsplash.com/photo-1534723452862-4c874018d66d?w=100', 'http://victoryprices.co.il', 'Credentials Required'),
        ('tiv_taam', 'https://images.unsplash.com/photo-1583258292688-d0213df4a3a8?w=100', 'http://tivtaam.co.il/prices', 'None')
    ]
    cursor.executemany(
        "UPDATE chains SET logo_url = ?, base_url = ?, auth_type = ? WHERE id = ?",
        [(logo, base, auth, cid) for cid, logo, base, auth in chains_demo_meta])

    # 3. Compile large list of supermarket branches in main Israeli cities
    cities_coords = {
        'ירושלים': (31.7683, 35.2137),
        'תל אביב': (32.0853, 34.7818),
        'חיפה': (32.7940, 34.9896),
        'באר שבע': (31.2530, 34.7915),
        'ראשון לציון': (31.9730, 34.7925),
        'פתח תקווה': (32.0871, 34.8875),
        'רחובות': (31.8928, 34.8113),
        'נתניה': (32.3215, 34.8532),
        'חולון': (32.0162, 34.7772),
        'בת ים': (32.0171, 34.7435),
        'רמת גן': (32.0823, 34.8107),
        'הרצליה': (32.1664, 34.8433),
        'אשדוד': (31.7921, 34.6333),
        'כפר סבא': (32.1750, 34.9064),
        'רעננה': (32.1848, 34.8713),
        'מודיעין': (31.8998, 35.0076),
        'בני ברק': (32.0833, 34.8333),
        'אשקלון': (31.6693, 34.5715),
        'בית שמש': (31.7470, 34.9881),
        'חדרה': (32.4340, 34.9197),
        'לוד': (31.9510, 34.8881),
        'רמלה': (31.9275, 34.8631),
        'גבעתיים': (32.0722, 34.8125),
        'הוד השרון': (32.1553, 34.8926),
        'קרית גת': (31.6034, 34.7718),
        'נהריה': (32.9996, 35.0933),
        'עפולה': (32.6078, 35.2897),
        'אילת': (29.5577, 34.9519),
        'קרית אתא': (32.8028, 35.1039),
        'אום אל-פחם': (32.5167, 35.1500),
        'קרית מוצקין': (32.8392, 35.0761),
        'קרית ים': (32.8464, 35.0683),
        'קרית ביאליק': (32.8319, 35.0903),
        'רמת השרון': (32.1392, 34.8397),
        'טבריה': (32.7922, 35.5312),
        'נצרת': (32.6996, 35.3035),
        'טייבה': (32.2647, 35.0125),
        'נס ציונה': (31.9250, 34.7981),
        'קרית שמונה': (33.2078, 35.5700),
        'כרמיאל': (32.9100, 35.2900),
        'דימונה': (31.0694, 34.9819),
        'אור יהודה': (32.0306, 34.8519),
        'יבנה': (31.8781, 34.7397),
        'יהוד': (32.0322, 34.8967),
        'צפת': (32.9658, 35.4983),
        'ערד': (31.2614, 35.2147),
        'שדרות': (31.5233, 34.5947),
        'אופקים': (31.3144, 34.6200),
        'נתיבות': (31.4189, 34.5950),
        'שפרעם': (32.8056, 35.1706),
        'מעלות תרשיחא': (33.0114, 35.2683),
        'מגדל העמק': (32.6736, 35.2403),
        'בית שאן': (32.4972, 35.4975),
        'נשר': (32.7631, 35.0394),
        'קרית אונו': (32.0628, 34.8572)
    }

    stores_data = []
    store_counter = 100

    # Distribute stores across all cities for all chains
    chains_list = ['shufersal', 'rami_levy', 'yohananof', 'victory', 'tiv_taam']
    chain_names = {
        'shufersal': 'שופרסל דיל',
        'rami_levy': 'רמי לוי',
        'yohananof': 'יוחננוף',
        'victory': 'ויקטורי',
        'tiv_taam': 'טיב טעם'
    }

    # Addresses presets
    addresses = [
        'הרצל {}', 'בן גוריון {}', 'ז\'בוטינסקי {}', 'דרך יפו {}', 'ארלוזורוב {}',
        'ויצמן {}', 'העצמאות {}', 'רוטשילד {}', 'ההסתדרות {}', 'הירקון {}'
    ]

    large_cities = {'ירושלים', 'תל אביב', 'חיפה', 'ראשון לציון', 'פתח תקווה', 'באר שבע', 'אשדוד', 'נתניה', 'חולון'}
    medium_cities = {
        'בת ים', 'רמת גן', 'הרצליה', 'כפר סבא', 'רעננה', 'מודיעין', 'בני ברק', 'אשקלון',
        'בית שמש', 'חדרה', 'לוד', 'רמלה', 'יבנה', 'קרית אונו', 'גבעתיים', 'הוד השרון',
        'נס ציונה', 'נצרת', 'כרמיאל', 'טבריה', 'עפולה', 'נהריה'
    }

    city_chains_mapping = {
        'ירושלים': ['shufersal', 'rami_levy', 'victory', 'yohananof'],
        'תל אביב': ['shufersal', 'victory', 'tiv_taam', 'rami_levy'],
        'חיפה': ['shufersal', 'rami_levy', 'victory', 'tiv_taam', 'yohananof'],
        'באר שבע': ['shufersal', 'rami_levy', 'victory', 'yohananof'],
        'ראשון לציון': ['shufersal', 'rami_levy', 'victory', 'yohananof', 'tiv_taam'],
        'פתח תקווה': ['shufersal', 'rami_levy', 'victory', 'yohananof'],
        'רחובות': ['shufersal', 'rami_levy', 'victory', 'yohananof', 'tiv_taam'],
        'נתניה': ['shufersal', 'rami_levy', 'victory', 'yohananof', 'tiv_taam'],
        'חולון': ['shufersal', 'victory', 'yohananof', 'rami_levy'],
        'בת ים': ['shufersal', 'victory', 'yohananof', 'tiv_taam'],
        'רמת גן': ['shufersal', 'victory', 'tiv_taam', 'rami_levy'],
        'הרצליה': ['shufersal', 'victory', 'tiv_taam'],
        'אשדוד': ['shufersal', 'rami_levy', 'victory', 'yohananof', 'tiv_taam'],
        'כפר סבא': ['shufersal', 'rami_levy', 'victory', 'tiv_taam'],
        'רעננה': ['shufersal', 'victory', 'tiv_taam'],
        'מודיעין': ['shufersal', 'rami_levy', 'victory', 'tiv_taam'],
        'בני ברק': ['shufersal'],
        'אשקלון': ['shufersal', 'rami_levy', 'victory', 'yohananof', 'tiv_taam'],
        'בית שמש': ['shufersal', 'rami_levy', 'victory'],
        'חדרה': ['shufersal', 'rami_levy', 'victory', 'tiv_taam'],
        'לוד': ['shufersal', 'victory', 'yohananof'],
        'רמלה': ['shufersal', 'victory', 'yohananof'],
        'גבעתיים': ['shufersal', 'victory', 'tiv_taam'],
        'הוד השרון': ['shufersal', 'victory', 'tiv_taam'],
        'קרית גת': ['shufersal', 'victory', 'yohananof'],
        'נהריה': ['shufersal', 'rami_levy', 'victory'],
        'עפולה': ['shufersal', 'rami_levy', 'victory'],
        'אילת': ['shufersal', 'rami_levy', 'victory', 'tiv_taam'],
        'קרית אתא': ['shufersal', 'rami_levy', 'victory'],
        'אום אל-פחם': ['shufersal'],
        'קרית מוצקין': ['shufersal', 'rami_levy', 'victory'],
        'קרית ים': ['shufersal', 'victory'],
        'קרית ביאליק': ['shufersal', 'victory', 'tiv_taam'],
        'רמת השרון': ['shufersal', 'victory', 'tiv_taam'],
        'טבריה': ['shufersal', 'rami_levy', 'victory'],
        'נצרת': ['shufersal'],
        'טייבה': ['shufersal'],
        'נס ציונה': ['shufersal', 'victory', 'yohananof', 'tiv_taam'],
        'קרית שמונה': ['shufersal', 'rami_levy', 'victory'],
        'כרמיאל': ['shufersal', 'rami_levy', 'victory'],
        'דימונה': ['shufersal', 'victory'],
        'אור יהודה': ['shufersal', 'victory', 'yohananof'],
        'יבנה': ['shufersal', 'victory', 'yohananof', 'tiv_taam'],
        'יהוד': ['shufersal', 'victory', 'tiv_taam'],
        'צפת': ['shufersal', 'rami_levy'],
        'ערד': ['shufersal', 'victory'],
        'שדרות': ['shufersal', 'rami_levy', 'victory'],
        'אופקים': ['shufersal', 'rami_levy'],
        'נתיבות': ['shufersal', 'rami_levy', 'victory', 'yohananof'],
        'שפרעם': ['shufersal'],
        'מעלות תרשיחא': ['shufersal', 'victory'],
        'מגדל העמק': ['shufersal', 'rami_levy', 'victory'],
        'בית שאן': ['shufersal', 'rami_levy'],
        'נשר': ['shufersal', 'rami_levy', 'victory'],
        'קרית אונו': ['shufersal', 'victory']
    }

    for city, (city_lat, city_lon) in cities_coords.items():
        if city in large_cities:
            num_stores = random.randint(15, 20)
        elif city in medium_cities:
            num_stores = random.randint(10, 14)
        else:
            num_stores = random.randint(5, 8)
        
        allowed_chains = city_chains_mapping.get(city, ['shufersal'])
        
        for _ in range(num_stores):
            chain = random.choice(allowed_chains)
            store_counter += 1
            store_id = str(store_counter)
            
            # Coordinate variation within city bounds (~3.5km radius)
            lat_offset = random.uniform(-0.025, 0.025)
            lon_offset = random.uniform(-0.025, 0.025)
            store_lat = city_lat + lat_offset
            store_lon = city_lon + lon_offset

            addr_num = random.randint(1, 199)
            addr_template = random.choice(addresses)
            store_addr = addr_template.format(addr_num)
            
            name = f"{chain_names[chain]} {city} ({store_addr})"
            id_str = f"{chain}_{store_id}"
            
            stores_data.append((id_str, chain, store_id, name, store_addr, city, store_lat, store_lon))

    cursor.executemany("INSERT INTO stores VALUES (?, ?, ?, ?, ?, ?, ?, ?)", stores_data)
    print(f"Seeded {len(stores_data)} stores across Israel.")

    # 4. Seed Products (100+ real supermarket products)
    products_catalog = [
        # Dairy (מוצרי חלב)
        ('7290000042420', 'קוטג\' תנובה 5% 250 גרם', 'תנובה', 'תנובה', 250, 'גרם', 0),
        ('7290000042437', 'קוטג\' תנובה 5% 500 גרם (גביע גדול)', 'תנובה', 'תנובה', 500, 'גרם', 0),
        ('7290004130086', 'קוטג\' טרה 5% 250 גרם', 'טרה', 'טרה', 250, 'גרם', 0),
        ('7290112349102', 'חלב תנובה 3% 1 ליטר קרטון', 'תנובה', 'תנובה', 1, 'ליטר', 0),
        ('7290004120018', 'חלב טרה 3% 1 ליטר קרטון', 'טרה', 'טרה', 1, 'ליטר', 0),
        ('7290000045018', 'חמאה תנובה 200 גרם', 'תנובה', 'תנובה', 200, 'גרם', 0),
        ('7290000048125', 'גבינת עמק פרוסה 200 גרם', 'תנובה', 'עמק', 200, 'גרם', 0),
        ('7290000048149', 'גבינת עמק פרוסה 400 גרם', 'תנובה', 'עמק', 400, 'גרם', 0),
        ('7290000043120', 'גבינה לבנה תנובה 5% 250 גרם', 'תנובה', 'תנובה', 250, 'גרם', 0),
        ('7290000043007', 'שמנת חמוצה תנובה 15% 200 מ"ל', 'תנובה', 'תנובה', 200, 'מ"ל', 0),
        ('7290013919023', 'מילקי שטראוס שוקולד עם קצפת', 'שטראוס', 'מילקי', 133, 'גרם', 0),
        ('7290139190308', 'שוקו יוטבתה 1 ליטר קרטון', 'שטראוס', 'יוטבתה', 1, 'ליטר', 0),
        ('7290103112006', 'יוגורט דנונה שטראוס טבעי 1.5% 200 גרם', 'שטראוס', 'דנונה', 200, 'גרם', 0),
        ('7290139191008', 'אקטימל שטראוס תות שמיניה (8x100 גרם)', 'שטראוס', 'אקטימל', 800, 'גרם', 0),

        # Bakery (לחם ומאפה)
        ('7290000135023', 'לחם אחיד פרוס 750 גרם', 'אנג\'ל', 'אנג\'ל', 750, 'גרם', 0),
        ('7290000136013', 'לחם חיטה מלאה פרוס 750 גרם', 'אנג\'ל', 'אנג\'ל', 750, 'גרם', 0),
        ('7290000212007', 'לחמניות המבורגר 6 יחידות', 'ברמן', 'ברמן', 6, 'יחידות', 0),
        ('7290000244107', 'פיתות אנג\'ל 10 יחידות', 'אנג\'ל', 'אנג\'ל', 10, 'יחידות', 0),
        ('7290000115209', 'עוגיות כעכים עגולים עבדי 300 גרם', 'עבדי', 'עבדי', 300, 'גרם', 0),

        # Pantry & Canned Goods (מכולת ושימורים)
        ('7290000358322', 'פסטה אסם פפיון 500 גרם', 'אסם', 'אסם', 500, 'גרם', 0),
        ('7290000358018', 'פסטה אסם ספגטי 500 גרם', 'אסם', 'אסם', 500, 'גרם', 0),
        ('7290011235123', 'אורז פרסי קלאסי שופרסל 1 ק"ג', 'שופרסל', 'שופרסל', 1000, 'גרם', 0),
        ('7290000062129', 'קטשופ אסם 750 גרם', 'אסם', 'אסם', 750, 'גרם', 0),
        ('7290000373462', 'קטשופ היינץ 700 גרם', 'היינץ', 'היינץ', 700, 'גרם', 0),
        ('7290112490102', 'שמן קנולה מזוכך 1 ליטר שופרסל', 'שופרסל', 'שופרסל', 1, 'ליטר', 0),
        ('7290000140225', 'שמן זית כתית מעולה יד מרדכי 750 מ"ל', 'יד מרדכי', 'יד מרדכי', 750, 'מ"ל', 0),
        ('7290000240109', 'טונה סטרקיסט בשמן קנולה 4 יחידות (4x140 גרם)', 'סטרקיסט', 'סטרקיסט', 560, 'גרם', 0),
        ('7290000240208', 'טונה סטרקיסט במים 4 יחידות (4x140 גרם)', 'סטרקיסט', 'סטרקיסט', 560, 'גרם', 0),
        ('7290000060019', 'רסק עגבניות טל 400 גרם', 'טל', 'טל', 400, 'גרם', 0),
        ('7290000222013', 'מיונז אמיתי הלמנס 400 מ"ל', 'יוניליוור', 'הלמנס', 400, 'מ"ל', 0),
        ('7290000064017', 'סוכר לבן 1 ק"ג', 'סוגת', 'סוגת', 1000, 'גרם', 0),
        ('7290000064116', 'קמח חיטה לבן מנופה סוגת 1 ק"ג', 'סוגת', 'סוגת', 1000, 'גרם', 0),
        ('7290000065014', 'מלח שולחן דק סוגת 1 ק"ג', 'סוגת', 'סוגת', 1000, 'גרם', 0),
        ('7290000065021', 'מלח ים אטלנטי גס מלח הארץ 1 ק"ג', 'מלח הארץ', 'מלח הארץ', 1000, 'גרם', 0),
        ('7290000065038', 'מלח שולחן מועשר ביוד מלח הארץ 250 גרם', 'מלח הארץ', 'מלח הארץ', 250, 'גרם', 0),
        ('7290000065045', 'מלח הימלאיה ורוד דק שופרסל 500 גרם', 'שופרסל', 'שופרסל', 500, 'גרם', 0),
        ('7290000065052', 'מלח ים אטלנטי דק מטחנה מלח הארץ 110 גרם', 'מלח הארץ', 'מלח הארץ', 110, 'גרם', 0),
        ('7290000085029', 'שימורי תירס מתוק יכין 340 גרם', 'יכין', 'יכין', 340, 'גרם', 0),

        # Beverages (משקאות)
        ('7290000323320', 'קוקה קולה 1.5 ליטר', 'החברה המרכזית', 'קוקה קולה', 1.5, 'ליטר', 0),
        ('7290000323344', 'קוקה קולה זירו 1.5 ליטר', 'החברה המרכזית', 'קוקה קולה', 1.5, 'ליטר', 0),
        ('7290000125437', 'מים מינרליים נביעות 6x1.5 ליטר', 'נביעות', 'נביעות', 9, 'ליטר', 0),
        ('7290000125406', 'מים מינרליים מי עדן 6x1.5 ליטר', 'מי עדן', 'מי עדן', 9, 'ליטר', 0),
        ('7290000341010', 'מיץ תפוזים סחוט פריגת 1.5 ליטר', 'פריגת', 'פריגת', 1.5, 'ליטר', 0),
        ('7290000322019', 'בירה גולדסטאר 6 בקבוקים (6x330 מ"ל)', 'טמפו', 'גולדסטאר', 1.98, 'ליטר', 0),

        # Coffee & Tea (קפה ותה)
        ('7290000155021', 'קפה נמס עלית 200 גרם', 'שטראוס עלית', 'עלית', 200, 'גרם', 0),
        ('7290000155106', 'קפה טורקי עלית 100 גרם', 'שטראוס עלית', 'עלית', 100, 'גרם', 0),
        ('7290000157018', 'תה תה ירוק סיני ויסוצקי 25 שקיקים', 'ויסוצקי', 'ויסוצקי', 25, 'יחידות', 0),
        ('7290000157124', 'תה קלאסי ויסוצקי 100 שקיקים', 'ויסוצקי', 'ויסוצקי', 100, 'יחידות', 0),
        ('7290000192309', 'קפסולות קפה לור אספרסו 10 יחידות', 'שטראוס', 'לור', 10, 'יחידות', 0),

        # Snacks & Sweets (חטיפים ומתוקים)
        ('7290000066110', 'במבה אסם 80 גרם', 'אסם', 'במבה', 80, 'גרם', 0),
        ('7290000066103', 'במבה אסם קטן 25 גרם', 'אסם', 'במבה', 25, 'גרם', 0),
        ('7290000068114', 'ביסלי גריל אסם 70 גרם', 'אסם', 'ביסלי', 70, 'גרם', 0),
        ('7290000068121', 'ביסלי בצל אסם 70 גרם', 'אסם', 'ביסלי', 70, 'גרם', 0),
        ('7290000080123', 'תפוצ\'יפס קלאסי עלית 50 גרם', 'שטראוס עלית', 'תפוצ\'יפס', 50, 'גרם', 0),
        ('7290000120104', 'שוקולד פרה חלב עלית 100 גרם', 'שטראוס עלית', 'שוקולד פרה', 100, 'גרם', 0),
        ('7290000120203', 'שוקולד פרה מריר עלית 100 גרם', 'שטראוס עלית', 'שוקולד פרה', 100, 'גרם', 0),
        ('7290000114011', 'וופל שוקולד ללא סוכר עלית 200 גרם', 'שטראוס עלית', 'עלית', 200, 'גרם', 0),

        # Hygiene & Cleaning (היגיינה וניקיון)
        ('7290000185011', 'נוזל כלים פיירי לימון 750 מ"ל', 'פרוקטר אנד גמבל', 'פיירי', 750, 'מ"ל', 0),
        ('7290000186100', 'אבקת כביסה אריאל 3 ק"ג', 'פרוקטר אנד גמבל', 'אריאל', 3000, 'גרם', 0),
        ('7290000119016', 'נייר טואלט לילי 30 גלילים', 'חוגלה קימברלי', 'לילי', 30, 'יחידות', 0),
        ('7290000119207', 'סבון נוזלי לידיים פלמוליב 500 מ"ל', 'קולגייט פלמוליב', 'פלמוליב', 500, 'מ"ל', 0),
        ('7290000119306', 'משחת שיניים קולגייט אופטיק וויט 75 מ"ל', 'קולגייט פלמוליב', 'קולגייט', 75, 'מ"ל', 0),
        ('7290000119504', 'שמפו הד אנד שולדרס קלאסי 500 מ"ל', 'פרוקטר אנד גמבל', 'הד אנד שולדרס', 500, 'מ"ל', 0)
    ]

    # Generate more random barcodes to make catalog hit 100+ items
    random.seed(42)
    categories = ['חטיפים', 'רטבים', 'שימורים', 'מתוקים', 'קפואים']
    manufacturers = ['יוניליוור', 'שסטוביץ', 'דיפלומט', 'חוגלה', 'נטו']
    brands = ['מותג הבית', 'סנו', 'אסם', 'תנובה', 'נסטלה']
    
    for i in range(1, 55):
        barcode = f"7290000888{i:03d}"
        name = f"מוצר צריכה מדגם {i} בקטגוריית {random.choice(categories)}"
        mfg = random.choice(manufacturers)
        brnd = random.choice(brands)
        qty = random.choice([100, 200, 250, 400, 500, 750])
        unit = random.choice(['גרם', 'מ"ל'])
        products_catalog.append((barcode, name, mfg, brnd, qty, unit, 0))

    cursor.executemany(
        """INSERT INTO products (barcode, name, manufacturer, brand, unit_qty, unit_of_measure, is_weighted)
           VALUES (?, ?, ?, ?, ?, ?, ?)""", products_catalog)
    print(f"Seeded {len(products_catalog)} products in the catalog.")

    # 5. Seed Prices across all stores for all products
    # Store price varies by chain profile
    chain_price_factors = {
        'rami_levy': 0.90,     # Generally cheapest
        'yohananof': 0.94,
        'victory': 0.96,
        'shufersal': 1.00,     # Standard reference
        'tiv_taam': 1.08       # Premium
    }

    # Reference prices for baseline products
    baseline_prices = {
        '7290000042420': 5.90,
        '7290000042437': 9.80,
        '7290004130086': 5.70,
        '7290112349102': 6.20,
        '7290004120018': 6.10,
        '7290000045018': 8.50,
        '7290000048125': 13.90,
        '7290000048149': 25.90,
        '7290000043120': 5.80,
        '7290000043007': 2.40,
        '7290013919023': 2.90,
        '7290139190308': 9.90,
        '7290103112006': 3.50,
        '7290139191008': 16.90,
        '7290000135023': 7.10,
        '7290000136013': 12.50,
        '7290000212007': 8.90,
        '7290000244107': 9.90,
        '7290000115209': 10.90,
        '7290000358322': 4.90,
        '7290000358018': 4.50,
        '729011235123': 8.50,
        '7290000062129': 10.50,
        '7290000373462': 12.90,
        '7290112490102': 7.90,
        '7290000140225': 32.90,
        '7290000240109': 21.90,
        '7290000240208': 20.90,
        '7290000060019': 3.90,
        '7290000222013': 14.90,
        '7290000064017': 3.80,
        '7290000064116': 4.20,
        '7290000065014': 2.20,
        '7290000065021': 6.90,
        '7290000065038': 3.10,
        '7290000065045': 9.90,
        '7290000065052': 7.50,
        '7290000085029': 4.50,
        '7290000323320': 6.90,
        '7290000323344': 6.90,
        '7290000125437': 11.90,
        '7290000125406': 12.90,
        '7290000341010': 13.90,
        '7290000322019': 34.90,
        '7290000155021': 16.90,
        '7290000155106': 6.50,
        '7290000157018': 14.90,
        '7290000157124': 24.90,
        '7290000192309': 15.90,
        '7290000066110': 4.50,
        '7290000066103': 1.90,
        '7290000068114': 4.20,
        '7290000068121': 4.20,
        '7290000080123': 4.90,
        '7290000120104': 5.50,
        '7290000120203': 5.90,
        '7290000114011': 6.90,
        '7290000185011': 9.90,
        '7290000186100': 29.90,
        '7290000119016': 36.90,
        '7290000119207': 8.90,
        '7290000119306': 12.90,
        '7290000119504': 17.90
    }

    prices_data = []
    
    for store in stores_data:
        store_id, chain_id = store[0], store[1]
        price_factor = chain_price_factors[chain_id]
        
        for prod in products_catalog:
            barcode = prod[0]
            unit_qty = prod[4]
            unit_of_measure = prod[5]
            
            # Baseline cost helper
            if barcode in baseline_prices:
                base_p = baseline_prices[barcode]
            else:
                # Fallback baseline price based on barcode value
                base_p = 5.0 + (int(barcode[-3:]) % 40)
            
            # Apply chain pricing factor and add minor random noise (-2% to +2%)
            noise = random.uniform(0.98, 1.02)
            store_price = round(base_p * price_factor * noise, 2)
            
            # Special cottage exception matching our core tests
            if barcode == '7290000042437' and chain_id == 'rami_levy':
                store_price = 8.90
            elif barcode == '7290000042420' and chain_id == 'rami_levy':
                store_price = 5.40
            elif barcode == '7290004130086' and chain_id == 'rami_levy':
                store_price = 5.20
            
            # Calculate unit price (price per 100g or 100ml or 1 unit)
            # unit_price = price / (unit_qty / 100)
            if unit_qty > 0:
                if unit_of_measure in ['גרם', 'מ"ל']:
                    unit_price = round(store_price / (unit_qty / 100.0), 2)
                else:
                    unit_price = round(store_price / unit_qty, 2)
            else:
                unit_price = store_price

            prices_data.append((store_id, barcode, store_price, unit_price,
                                datetime.now().strftime('%Y-%m-%d %H:%M')))

    cursor.executemany("INSERT INTO prices VALUES (?, ?, ?, ?, ?)", prices_data)
    print(f"Seeded {len(prices_data)} price mappings across all stores.")

    # 6. Seed demo promotions so the promo API/UI paths work without real data.
    # Mix of regular, club-only, multi-buy (min_qty=2) and a few expired ones.
    now = datetime.now()
    promo_start = (now - timedelta(days=3)).strftime('%Y-%m-%d %H:%M')
    promo_end = (now + timedelta(days=14)).strftime('%Y-%m-%d %H:%M')
    expired_end = (now - timedelta(days=1)).strftime('%Y-%m-%d %H:%M')
    updated_at = now.strftime('%Y-%m-%d %H:%M')

    price_lookup = {(p[0], p[1]): p[2] for p in prices_data}
    promo_barcodes = ['7290000042420', '7290000066110', '7290000323320',
                      '7290000373462', '7290000155021', '7290000119016']

    promo_count = 0
    for store in random.sample(stores_data, k=int(len(stores_data) * 0.35)):
        store_id, chain_id = store[0], store[1]
        for barcode in random.sample(promo_barcodes, k=3):
            price = price_lookup.get((store_id, barcode))
            if price is None:
                continue
            promo_count += 1
            requires_club = 1 if random.random() < 0.25 else 0
            min_qty = 2 if random.random() < 0.15 else 1
            discounted = round(price * random.uniform(0.70, 0.88), 2)
            end_date = expired_end if random.random() < 0.10 else promo_end
            cursor.execute(
                """INSERT INTO promotions
                     (chain_id, store_id, promotion_id, description, start_date, end_date,
                      min_qty, discounted_price, requires_club, club_id, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (chain_id, store_id, f'DEMO-{promo_count}',
                 'מבצע דמו: מחיר מיוחד', promo_start, end_date,
                 min_qty, discounted, requires_club,
                 'demo_club' if requires_club else None, updated_at))
            cursor.execute(
                """INSERT INTO promotion_items
                     (promotion_row_id, barcode, min_qty, discounted_price)
                   VALUES (?, ?, ?, ?)""",
                (cursor.lastrowid, barcode, min_qty, discounted))
    print(f"Seeded {promo_count} demo promotions.")

    # 7. Demo scraper statuses (migrate created idle rows for all chains)
    scrapers = [
        ('shufersal', 'idle', '2026-05-21 02:14', 142, 4, 52.4, 'Success', None),
        ('rami_levy', 'idle', '2026-05-21 01:45', 210, 6, 78.1, 'Success', None),
        ('yohananof', 'idle', '2026-05-21 03:05', 94, 2, 18.5, 'Success', None),
        ('victory', 'error', '2026-05-21 00:30', 35, 0, 0, 'Failed', 'HTTP 403 Forbidden: IP rate limit blocked'),
        ('tiv_taam', 'idle', '2026-05-21 04:12', 112, 3, 24.8, 'Success', None)
    ]
    cursor.executemany("INSERT OR REPLACE INTO scraper_status VALUES (?, ?, ?, ?, ?, ?, ?, ?)", scrapers)

    conn.commit()
    rebuild_fts(conn)
    conn.close()
    print("Demo database seeding completed successfully.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Seed SYNTHETIC demo data into a fresh database.')
    parser.add_argument('--demo', action='store_true',
                        help='required confirmation that you want synthetic data')
    parser.add_argument('--db', default=None, help='path to the SQLite database')
    args = parser.parse_args()
    if not args.demo:
        print('This script generates SYNTHETIC demo data and must not run against a')
        print('real-data database. Re-run with --demo to confirm, e.g.:')
        print('  python seed_production_data.py --demo --db demo.db')
        sys.exit(1)
    seed_database(args.db)
