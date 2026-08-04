import os
import csv
import json
import re

# Directory paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_DIR = os.path.join(BASE_DIR, 'rates_csv')
OUTPUT_FILE = os.path.join(BASE_DIR, 'js', 'shipping_rates.js')

BRACKETS = ['0-1', '1-3', '3-6', '6-9', '9-12', '12-15', '15-18']

def normalize_key(name):
    if not name:
        return ""
    # Normalize unicode accents
    import unicodedata
    normalized = unicodedata.normalize('NFD', name)
    normalized = "".join([c for c in normalized if unicodedata.category(c) != 'Mn'])
    # Lowecase, remove special chars and extra spaces
    normalized = normalized.lower().replace('ñ', 'n')
    normalized = re.sub(r'[^a-z\s]', '', normalized)
    return normalized.strip()

def parse_int_safe(val):
    if not val:
        return None
    # Remove dots, spaces, currency symbols, commas
    cleaned = re.sub(r'[^\d]', '', val)
    return int(cleaned) if cleaned else None

def main():
    if not os.path.exists(CSV_DIR):
        print(f"Error: La carpeta '{CSV_DIR}' no existe. Por favor créala y coloca los CSV exportados de cada pestaña ahí.")
        print(f"Los nombres esperados son: {', '.join([b + '.csv' for b in BRACKETS])}")
        return

    rates_db = {}

    for bracket in BRACKETS:
        csv_path = os.path.join(CSV_DIR, f"{bracket}.csv")
        if not os.path.exists(csv_path):
            print(f"Advertencia: No se encontró el archivo para el tramo {bracket} en: {csv_path}. Se omitirá este tramo.")
            continue

        print(f"Procesando {bracket}...")
        with open(csv_path, 'r', encoding='utf-8') as f:
            # Detectar cabeceras y limpiar BOM si existe
            reader = csv.reader(f)
            headers = next(reader)
            headers = [h.strip().replace('\ufeff', '') for h in headers]

            # Buscar índices de columnas
            # Esperado: Comuna, Región, Starken, Bluexpress, Chilexpress
            comuna_idx = -1
            region_idx = -1
            starken_idx = -1
            blue_idx = -1
            chile_idx = -1

            for idx, h in enumerate(headers):
                h_upper = h.upper()
                if "COMUNA" in h_upper:
                    comuna_idx = idx
                elif "REGION" in h_upper or "REGIÓN" in h_upper:
                    region_idx = idx
                elif "STARKEN" in h_upper:
                    starken_idx = idx
                elif "BLUE" in h_upper or "BEX" in h_upper:
                    blue_idx = idx
                elif "CHILEXPRESS" in h_upper:
                    chile_idx = idx

            if comuna_idx == -1:
                print(f"Error en {bracket}.csv: No se encontró columna 'Comuna'. Cabeceras leídas: {headers}")
                continue

            for row in reader:
                if not row or len(row) <= comuna_idx:
                    continue
                comuna_raw = row[comuna_idx].strip()
                if not comuna_raw:
                    continue

                key = normalize_key(comuna_raw)
                region = row[region_idx].strip() if region_idx != -1 and region_idx < len(row) else ""
                
                # Inicializar comuna si no existe
                if key not in rates_db:
                    rates_db[key] = {
                        "region": region,
                        "comuna": comuna_raw,
                        "rates": {b: {"starken": None, "bluexpress": None, "chilexpress": None} for b in BRACKETS}
                    }

                # Extraer precios
                starken_price = parse_int_safe(row[starken_idx]) if starken_idx != -1 and starken_idx < len(row) else None
                blue_price = parse_int_safe(row[blue_idx]) if blue_idx != -1 and blue_idx < len(row) else None
                chile_price = parse_int_safe(row[chile_idx]) if chile_idx != -1 and chile_idx < len(row) else None

                rates_db[key]["rates"][bracket]["starken"] = starken_price
                rates_db[key]["rates"][bracket]["bluexpress"] = blue_price
                rates_db[key]["rates"][bracket]["chilexpress"] = chile_price

    if not rates_db:
        print("No se compilaron tarifas. Revisa tus archivos CSV.")
        return

    # Escribir el archivo JS final
    js_content = f"// Compiled shipping rates for Chile regions by weight brackets (net rates)\n"
    js_content += f"window.shippingRates = {json.dumps(rates_db, indent=2, ensure_ascii=False)};\n"

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(js_content)

    print(f"¡Éxito! Archivo de tarifas compilado en: {OUTPUT_FILE}")
    print(f"Se procesaron {len(rates_db)} comunas en total.")

if __name__ == '__main__':
    main()
