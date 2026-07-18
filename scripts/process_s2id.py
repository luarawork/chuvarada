"""
process_s2id.py

Input: dados-brutos/S2ID/{BA,PE,RN}/{2013,2014,2015,2016}.xls
       Planilhas de Reconhecimento de Situação de Emergência (SE) / Estado
       de Calamidade Pública (ECP) do S2ID (Sistema Integrado de Informações
       sobre Desastres, Ministério da Integração Nacional / Defesa Civil).
       Cada linha é um decreto de reconhecimento de desastre por município.

       O layout varia por ano:
       - 2013-2015: cabeçalho na linha 0, "Data do Decreto" como data serial
         do Excel.
       - 2016: bloco de título nas linhas 0-4, cabeçalho na linha 5, uma
         coluna vazia extra à esquerda, "Data do Decreto" como texto
         "dd/mm/aaaa".
       Este script detecta o cabeçalho dinamicamente em vez de assumir
       índice de coluna fixo.

Output: dados-brutos/S2ID/s2id_filtered.json — só os eventos de
        Salvador/Recife/Natal classificados como alagamento/inundação/
        enxurrada (a granularidade do S2ID é por MUNICÍPIO, não há bairro).

Dependências: xlrd

Uso: python scripts/process_s2id.py
"""

import glob
import json
import re
from datetime import date, datetime, timedelta

import xlrd

TARGET_MUNICIPIOS = {"SALVADOR": "BA", "RECIFE": "PE", "NATAL": "RN"}
FLOOD_TYPES = {"ALAGAMENTOS", "INUNDAÇÕES", "ENXURRADAS"}

HEADER_ALIASES = {
    "municipio": ["MUNICÍPIO"],
    "desastre": ["DESASTRE"],
    "data_decreto": ["DATA DO DECRETO"],
    "numero_decreto": ["N° DO DECRETO", "Nº DO DECRETO"],
    "uf": ["UF"],
    "codigo_ibge": ["CÓDIGO IBGE"],
    "se_ecp": ["SE/ECP"],
}


def strip_accents_upper(s: str) -> str:
    return s.strip().upper()


def find_header_row(sheet) -> tuple[int, dict]:
    """Procura, nas primeiras linhas, a que contém os cabeçalhos esperados
    (o layout de 2016 tem um bloco de título antes do cabeçalho de verdade)."""
    for r in range(min(10, sheet.nrows)):
        row = [strip_accents_upper(str(sheet.cell_value(r, c))) for c in range(sheet.ncols)]
        if "MUNICÍPIO" in row and "DESASTRE" in row:
            col_map = {}
            for key, aliases in HEADER_ALIASES.items():
                for alias in aliases:
                    if alias in row:
                        col_map[key] = row.index(alias)
                        break
            return r, col_map
    raise ValueError("Cabeçalho não encontrado nas primeiras 10 linhas")


def parse_date_cell(sheet, workbook, row: int, col: int):
    value = sheet.cell_value(row, col)
    if isinstance(value, float):
        try:
            dt = xlrd.xldate_as_datetime(value, workbook.datemode)
            return dt.date().isoformat()
        except Exception:
            return None
    if isinstance(value, str) and value.strip():
        match = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", value.strip())
        if match:
            day, month, year = map(int, match.groups())
            try:
                return date(year, month, day).isoformat()
            except ValueError:
                return None
    return None


def process_file(path: str) -> list[dict]:
    wb = xlrd.open_workbook(path)
    sheet = wb.sheet_by_index(0)
    header_row, col_map = find_header_row(sheet)

    required = {"municipio", "desastre", "data_decreto"}
    missing = required - col_map.keys()
    if missing:
        raise ValueError(f"{path}: colunas obrigatórias não encontradas: {missing}")

    events = []
    for r in range(header_row + 1, sheet.nrows):
        municipio_raw = str(sheet.cell_value(r, col_map["municipio"])).strip()
        if not municipio_raw:
            continue
        municipio = strip_accents_upper(municipio_raw)
        if municipio not in TARGET_MUNICIPIOS:
            continue

        desastre = strip_accents_upper(str(sheet.cell_value(r, col_map["desastre"])))
        if desastre not in FLOOD_TYPES:
            continue

        event_date = parse_date_cell(sheet, wb, r, col_map["data_decreto"])

        events.append(
            {
                "municipio": municipio_raw,
                "uf": TARGET_MUNICIPIOS[municipio],
                "desastre": desastre,
                "event_date": event_date,
                "numero_decreto": (
                    str(sheet.cell_value(r, col_map["numero_decreto"]))
                    if "numero_decreto" in col_map
                    else None
                ),
                "se_ecp": (
                    str(sheet.cell_value(r, col_map["se_ecp"])) if "se_ecp" in col_map else None
                ),
                "source_file": path.replace("\\", "/"),
            }
        )
    return events


def main():
    files = sorted(glob.glob("dados-brutos/S2ID/*/*.xls"))
    all_events = []
    for f in files:
        events = process_file(f)
        print(f"{f}: {len(events)} eventos de alagamento/inundação/enxurrada em Salvador/Recife/Natal")
        all_events.extend(events)

    out_path = "dados-brutos/S2ID/s2id_filtered.json"
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(all_events, fh, ensure_ascii=False, indent=2)

    print(f"\nTotal: {len(all_events)} eventos -> {out_path}")

    by_city = {}
    for e in all_events:
        by_city.setdefault(e["municipio"], 0)
        by_city[e["municipio"]] += 1
    print("Por cidade:", by_city)


if __name__ == "__main__":
    main()
