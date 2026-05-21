import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'database.db')

def optimize():
    print("Optimizing SQLite database with production indices...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Index on prices barcode for quick product price lookups
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_prices_barcode ON prices(barcode)")
    
    # Index on prices store_id for store-specific checks
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_prices_store_id ON prices(store_id)")

    # Composite index for search sorting (unit price + barcode)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_prices_barcode_unit ON prices(barcode, unit_price)")

    # Index on products name and brand for text search queries
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand)")

    # Index on stores chain_id and location
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_stores_chain_id ON stores(chain_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_stores_city ON stores(city)")

    # Enable WAL mode for parallel read/write performance
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")

    conn.commit()
    conn.close()
    print("Database optimization indices successfully created.")

if __name__ == '__main__':
    optimize()
