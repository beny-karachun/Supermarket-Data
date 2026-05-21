import xml.etree.ElementTree as ET
import gzip
import sqlite3
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), 'database.db')

def parse_stores_xml(file_path, chain_id):
    """
    Parses a Stores XML (or .gz) file and inserts branches into the database.
    """
    print(f"Parsing stores file: {file_path} for chain: {chain_id}")
    
    # Handle gzip files automatically
    open_func = gzip.open if file_path.endswith('.gz') else open
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    stores_batch = []
    
    # Incremental parse to save memory
    context = ET.iterparse(open_func(file_path, 'rb'), events=('end',))
    for event, elem in context:
        if elem.tag == 'Store' or elem.tag == 'SUBCHAIN':
            # Handle standard store format
            store_id = elem.findtext('StoreId') or elem.findtext('STOREID')
            name = elem.findtext('StoreName') or elem.findtext('STORENAME')
            address = elem.findtext('Address') or elem.findtext('ADDRESS') or ''
            city = elem.findtext('City') or elem.findtext('CITY') or ''
            lat_str = elem.findtext('Latitude') or elem.findtext('LATITUDE')
            lon_str = elem.findtext('Longitude') or elem.findtext('LONGITUDE')
            
            if store_id and name and lat_str and lon_str:
                try:
                    lat = float(lat_str)
                    lon = float(lon_str)
                    
                    # Clean coordinate issues (some systems report 0.0 or flipped coordinates)
                    if lat > 0 and lon > 0:
                        db_store_id = f"{chain_id}_{store_id}"
                        stores_batch.append((db_store_id, chain_id, store_id, name, address, city, lat, lon))
                except ValueError:
                    pass
            
            # Clear element to free memory
            elem.clear()
            
    if stores_batch:
        cursor.executemany("""
            INSERT OR REPLACE INTO stores (id, chain_id, store_id, name, address, city, latitude, longitude)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, stores_batch)
        print(f"Successfully upserted {len(stores_batch)} branches.")
    
    conn.commit()
    conn.close()

def parse_prices_xml(file_path, chain_id, store_id):
    """
    Parses a PriceFull XML (or .gz) file and inserts products and pricing.
    """
    print(f"Parsing price file: {file_path} for store: {store_id}")
    
    open_func = gzip.open if file_path.endswith('.gz') else open
    db_store_id = f"{chain_id}_{store_id}"
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    products_batch = []
    prices_batch = []
    
    context = ET.iterparse(open_func(file_path, 'rb'), events=('end',))
    
    count = 0
    for event, elem in context:
        if elem.tag == 'Product' or elem.tag == 'Item':
            barcode = elem.findtext('ItemCode') or elem.findtext('ITEMCODE')
            name = elem.findtext('ItemName') or elem.findtext('ITEMNAME')
            mfg = elem.findtext('ManufactureName') or elem.findtext('MANUFACTURERNAME') or ''
            brand = elem.findtext('BrandName') or elem.findtext('BRANDNAME') or ''
            
            price_str = elem.findtext('ItemPrice') or elem.findtext('ITEMPRICE')
            qty_str = elem.findtext('Quantity') or elem.findtext('QUANTITY') or '1.0'
            unit_str = elem.findtext('UnitOfMeasure') or elem.findtext('UNITOFMEASURE') or 'יחידה'
            
            if barcode and name and price_str:
                try:
                    price = float(price_str)
                    qty = float(qty_str)
                    
                    # Calculate unit price
                    if qty > 0:
                        if unit_str in ['גרם', 'מ"ל']:
                            unit_price = round(price / (qty / 100.0), 2)
                        else:
                            unit_price = round(price / qty, 2)
                    else:
                        unit_price = price
                    
                    products_batch.append((barcode, name, mfg, brand, qty, unit_str, 0))
                    prices_batch.append((db_store_id, barcode, price, unit_price, '2026-05-21 14:00'))
                    
                except ValueError:
                    pass
                
            # Clear element to free memory
            elem.clear()
            
            count += 1
            if count % 2000 == 0:
                # Flush batches in transaction to avoid memory building up
                cursor.executemany("""
                    INSERT OR IGNORE INTO products (barcode, name, manufacturer, brand, unit_qty, unit_of_measure, is_weighted)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, products_batch)
                
                cursor.executemany("""
                    INSERT OR REPLACE INTO prices (store_id, barcode, price, unit_price, last_updated)
                    VALUES (?, ?, ?, ?, ?)
                """, prices_batch)
                
                products_batch = []
                prices_batch = []
                print(f"Processed {count} items...")

    # Flush remaining records
    if products_batch:
        cursor.executemany("""
            INSERT OR IGNORE INTO products (barcode, name, manufacturer, brand, unit_qty, unit_of_measure, is_weighted)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, products_batch)
        
        cursor.executemany("""
            INSERT OR REPLACE INTO prices (store_id, barcode, price, unit_price, last_updated)
            VALUES (?, ?, ?, ?, ?)
        """, prices_batch)
        
    print(f"Parsing complete. Upserted {count} items for store {db_store_id}.")
    
    conn.commit()
    conn.close()

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage:")
        print("  python parse_supermarket_xml.py stores <file_path> <chain_id>")
        print("  python parse_supermarket_xml.py prices <file_path> <chain_id> <store_id>")
        sys.exit(1)
        
    mode = sys.argv[1]
    path_arg = sys.argv[2]
    chain = sys.argv[3]
    
    if mode == 'stores':
        parse_stores_xml(path_arg, chain)
    elif mode == 'prices':
        if len(sys.argv) < 5:
            print("Please specify store_id for prices mode.")
            sys.exit(1)
        store = sys.argv[4]
        parse_prices_xml(path_arg, chain, store)
