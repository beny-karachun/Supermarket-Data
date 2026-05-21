import urllib.request
import re
import gzip
import xml.etree.ElementTree as ET
import os
import html

# Target site configuration
URL = 'https://prices.shufersal.co.il/'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

def clean_url(raw_url):
    return html.unescape(raw_url)

def generate_mock_gz_file(compressed_path):
    # Generates a realistic supermarket XML file matching the official schema
    xml_data = """<?xml version="1.0" encoding="utf-8"?>
<root>
    <Header>
        <ItemsCount>5</ItemsCount>
        <ChainId>7290027600007</ChainId>
        <StoreId>1</StoreId>
        <FileDateTime>2026-05-21 03:00</FileDateTime>
    </Header>
    <Items>
        <Item>
            <ItemCode>7290000042420</ItemCode>
            <ItemName>קוטג' תנובה 5% 250 גרם</ItemName>
            <ItemPrice>5.90</ItemPrice>
            <ManufactureName>תנובה</ManufactureName>
        </Item>
        <Item>
            <ItemCode>7290013919023</ItemCode>
            <ItemName>מילקי שטראוס שוקולד עם קצפת</ItemName>
            <ItemPrice>2.90</ItemPrice>
            <ManufactureName>שטראוס</ManufactureName>
        </Item>
        <Item>
            <ItemCode>7290000155021</ItemCode>
            <ItemName>קפה נמס עלית 200 גרם</ItemName>
            <ItemPrice>16.90</ItemPrice>
            <ManufactureName>שטראוס עלית</ManufactureName>
        </Item>
        <Item>
            <ItemCode>7290000373462</ItemCode>
            <ItemName>קטשופ היינץ 700 גרם</ItemName>
            <ItemPrice>12.90</ItemPrice>
            <ManufactureName>היינץ</ManufactureName>
        </Item>
        <Item>
            <ItemCode>7290000066110</ItemCode>
            <ItemName>במבה אסם 80 גרם</ItemName>
            <ItemPrice>4.50</ItemPrice>
            <ManufactureName>אסם</ManufactureName>
        </Item>
    </Items>
</root>
"""
    # Gzip compress the XML data
    with gzip.open(compressed_path, 'wb') as f:
        f.write(xml_data.encode('utf-8'))
    print("נוצר קובץ מדמה מקומי (PriceFull_Mock.xml.gz) בהצלחה.")

def main():
    print("=== שלב 1: התחברות לשרת שופרסל וקבלת רשימת קבצים ===")
    
    temp_dir = os.path.join(os.path.dirname(__file__), 'temp')
    os.makedirs(temp_dir, exist_ok=True)
    
    filename = "PriceFull7290027600007-001-20260521.xml.gz"
    compressed_path = os.path.join(temp_dir, filename)
    decompressed_path = os.path.join(temp_dir, filename.replace('.gz', ''))
    
    using_mock = False
    
    try:
        req = urllib.request.Request(URL, headers=HEADERS)
        # Try to connect with a short timeout of 5 seconds
        with urllib.request.urlopen(req, timeout=5) as response:
            html_content = response.read().decode('utf-8', errors='ignore')
            
        links = re.findall(r'href="([^"]+\.gz\?[^"]+)"', html_content)
        if not links:
            links = re.findall(r'href="([^"]+\.gz)"', html_content)
            
        if not links:
            raise Exception("לא נמצאו קבצים בדף האינדקס")
            
        print(f"חיבור חי הצליח! נמצאו {len(links)} קבצים להורדה.")
        
        price_links = [l for l in links if 'Price' in l]
        target_link = clean_url(price_links[0]) if price_links else clean_url(links[0])
        
        # Download live file
        print(f"\n=== שלב 2: הורדת הקובץ משרתי שופרסל ===")
        print(f"מוריד קובץ... קישור: {target_link[:80]}...")
        req_download = urllib.request.Request(target_link, headers=HEADERS)
        with urllib.request.urlopen(req_download, timeout=10) as response, open(compressed_path, 'wb') as out_file:
            out_file.write(response.read())
        print("הורדה הושלמה!")
            
    except Exception as e:
        print(f"\n[שים לב] שגיאת חיבור (ייתכן עקב חסימת מיקום גיאוגרפי): {e}")
        print("מפעיל מנגנון גיבוי (Fallback) - יצירת קובץ נתונים מדמה...")
        generate_mock_gz_file(compressed_path)
        using_mock = True

    print(f"\n=== שלב 3: חילוץ קובץ (Decompression) ===")
    try:
        with gzip.open(compressed_path, 'rb') as f_in, open(decompressed_path, 'wb') as f_out:
            f_out.write(f_in.read())
        print(f"הקובץ חולץ בהצלחה לכתובת: {decompressed_path}")
    except Exception as e:
        print(f"שגיאה בחילוץ הקובץ: {e}")
        return

    print(f"\n=== שלב 4: ניתוח XML (Parsing) ===")
    try:
        print("מנתח את מבנה ה-XML...")
        context = ET.iterparse(decompressed_path, events=('end',))
        
        items_parsed = 0
        max_to_print = 15
        
        print("\nמוצרים שנסרקו מהקובץ:")
        print(f"{'ברקוד (ItemCode)':<18} | {'שם מוצר (ItemName)':<40} | {'מחיר (ItemPrice)':<10}")
        print("-" * 76)
        
        for event, elem in context:
            if elem.tag == 'Item':
                item_code = elem.findtext('ItemCode')
                item_name = elem.findtext('ItemName')
                item_price = elem.findtext('ItemPrice')
                
                if item_code and item_name and item_price:
                    item_name_clean = " ".join(item_name.split())
                    print(f"{item_code:<18} | {item_name_clean[:38]:<40} | ₪{float(item_price):.2f}")
                    items_parsed += 1
                
                elem.clear()
                if items_parsed >= max_to_print:
                    break
                    
        print("-" * 76)
        print(f"הסריקה הושלמה בהצלחה! נותחו {items_parsed} מוצרים.")
        if using_mock:
            print("(הנתונים נותחו בהצלחה ממנגנון הגיבוי הלא מקוון)")
        else:
            print("(הנתונים נותחו בהצלחה מהורדה חיה של שרת שופרסל!)")
        
    except Exception as e:
        print(f"שגיאה בניתוח קובץ ה-XML: {e}")
        
    finally:
        # Clean up files
        if os.path.exists(compressed_path):
            os.remove(compressed_path)
        if os.path.exists(decompressed_path):
            os.remove(decompressed_path)
        print("\nקבצים זמניים נוקו מהדיסק.")

if __name__ == '__main__':
    main()
