"""
process_inmet_extremes.py

Input: CSVs anuais do INMET (BDMEP) — um por estação automática por ano,
       baixados de https://portal.inmet.gov.br/uploads/dadoshistoricos/{ano}.zip
       e extraídos em dados-brutos/inmet/{ano}/INMET_..._{codigo}_{ESTACAO}_*.CSV.
       Cada arquivo tem 8 linhas de metadado, depois uma linha de cabeçalho,
       depois uma linha por hora (24/dia) com a coluna "PRECIPITAÇÃO TOTAL,
       HORÁRIO (mm)" em formato decimal brasileiro (vírgula).

Processo:
1. Somar a precipitação horária por dia -> total diário (mm/24h) por cidade.
2. Marcar como candidato a evento de alagamento os dias com total > 50mm.
3. Exportar como JSON pra importação em historical_events (nível de cidade,
   já que o INMET só tem uma estação por cidade, não por bairro).

Uso: python scripts/process_inmet_extremes.py --years 2021 2022 2023 2024 2025
"""

import argparse
import csv
import json
import os
from collections import defaultdict

STATIONS = {
    "A401": "Salvador",
    "A301": "Recife",
    "A304": "Natal",
}

THRESHOLD_MM = 50.0


def parse_br_float(value: str) -> float:
    value = value.strip()
    if not value:
        return 0.0
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return 0.0


def find_station_csv(inmet_dir: str, year: int, station_code: str) -> str | None:
    year_dir = os.path.join(inmet_dir, str(year))
    if not os.path.isdir(year_dir):
        return None
    for filename in os.listdir(year_dir):
        if station_code in filename and filename.upper().endswith(".CSV"):
            return os.path.join(year_dir, filename)
    return None


def daily_totals_for_station(csv_path: str) -> dict[str, float]:
    """Retorna {data (YYYY-MM-DD): total de chuva no dia (mm)}."""
    totals: dict[str, float] = defaultdict(float)
    with open(csv_path, encoding="latin1") as f:
        for _ in range(8):  # pula as 8 linhas de metadado
            next(f)
        reader = csv.reader(f, delimiter=";")
        header = next(reader)
        precip_idx = next(
            i for i, col in enumerate(header) if "PRECIPITA" in col.upper()
        )
        for row in reader:
            if len(row) <= precip_idx or not row[0]:
                continue
            date_str = row[0].replace("/", "-")
            totals[date_str] += parse_br_float(row[precip_idx])
    return dict(totals)


def main():
    parser = argparse.ArgumentParser(description="Identifica dias de precipitação extrema (INMET)")
    parser.add_argument("--years", nargs="+", type=int, required=True)
    parser.add_argument("--inmet-dir", default="dados-brutos/inmet")
    parser.add_argument("--threshold", type=float, default=THRESHOLD_MM)
    parser.add_argument("--output", default="scripts/inmet_extreme_events.json")
    args = parser.parse_args()

    events = []
    summary: dict[str, dict[str, int]] = {}

    for station_code, city_name in STATIONS.items():
        summary[city_name] = {"dias_processados": 0, "dias_extremos": 0}
        for year in args.years:
            csv_path = find_station_csv(args.inmet_dir, year, station_code)
            if not csv_path:
                print(f"[aviso] {city_name} ({station_code}): sem CSV pra {year}")
                continue
            totals = daily_totals_for_station(csv_path)
            summary[city_name]["dias_processados"] += len(totals)
            for date_str, total_mm in totals.items():
                if total_mm > args.threshold:
                    events.append(
                        {
                            "city_name": city_name,
                            "date": date_str,
                            "precipitation_mm": round(total_mm, 1),
                        }
                    )
                    summary[city_name]["dias_extremos"] += 1
            print(f"{city_name} {year}: {len(totals)} dias lidos")

    events.sort(key=lambda e: (e["city_name"], e["date"]))

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2)

    print(f"\n{len(events)} dias com precipitação > {args.threshold}mm/24h -> {args.output}")
    for city_name, stats in summary.items():
        print(f"  {city_name}: {stats['dias_extremos']} eventos em {stats['dias_processados']} dias processados")


if __name__ == "__main__":
    main()
