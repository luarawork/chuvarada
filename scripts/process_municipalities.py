"""Processa a malha municipal nacional do IBGE (BR_Municipios_2022) pros
modos heatmap/municipality do mapa no zoom afastado.

1. Lê o shapefile nacional (5.572 municípios do Brasil inteiro).
2. Filtra só os municípios que já existem em `cities` no banco (4.653,
   nos 16 estados cobertos) -- cruzando por (nome, estado).
3. Simplifica a geometria (tolerância 0,02° -- adequada pra zoom afastado,
   bem mais agressiva que a dos bairros porque nesse zoom o contorno
   precisa só ser reconhecível, não preciso. Ajustada de 0,005° pra 0,02°
   depois de medir ~7,4s/7,7MB pra carregar os 4.650 municípios de uma vez
   no modo heatmap -- ver diagnóstico de performance).
4. Calcula o centroide.
5. Exporta como GeoJSON (public/geojson/municipalities.geojson), pro
   upload_municipalities.js inserir na tabela `municipalities`.

Uso:
  python scripts/process_municipalities.py \
    --shapefile dados-brutos/ibge/br/BR_Municipios_2022/BR_Municipios_2022.shp \
    --cities-csv <caminho para um CSV com id,name,state de `cities`>
"""
import argparse
import json

import geopandas as gpd

SIMPLIFY_TOLERANCE = 0.02


def normalize(name: str) -> str:
    return name.strip().casefold()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--shapefile", required=True)
    parser.add_argument("--cities-csv", required=True, help="CSV com colunas id,name,state exportado de `cities`")
    parser.add_argument("--output", default="public/geojson/municipalities.geojson")
    args = parser.parse_args()

    print("Lendo shapefile nacional...")
    gdf = gpd.read_file(args.shapefile)
    print(f"{len(gdf)} municípios no shapefile nacional.")

    import csv

    cities_by_key = {}
    with open(args.cities_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = (normalize(row["name"]), row["state"].strip().upper())
            cities_by_key[key] = row["id"]
    print(f"{len(cities_by_key)} cidades carregadas do banco.")

    features = []
    matched_keys = set()
    for _, row in gdf.iterrows():
        key = (normalize(row["NM_MUN"]), row["SIGLA_UF"].strip().upper())
        city_id = cities_by_key.get(key)
        if not city_id:
            continue
        matched_keys.add(key)

        geometry = row.geometry
        simplified = geometry.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
        centroid = geometry.centroid

        # Só geometry_simplified é gravada -- a versão em resolução plena
        # nunca foi lida em lugar nenhum do app (route.ts sempre serviu
        # geometry_simplified), e pra malha nacional inteira ela sozinha
        # gera um GeoJSON grande demais pra fs.readFileSync do Node
        # (ver migração 024).
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "city_id": city_id,
                    "name": row["NM_MUN"],
                    "state": row["SIGLA_UF"],
                    "centroid_lat": centroid.y,
                    "centroid_lng": centroid.x,
                },
                "geometry_simplified": json.loads(gpd.GeoSeries([simplified]).to_json())["features"][0]["geometry"],
            }
        )

    missing = set(cities_by_key.keys()) - matched_keys
    print(f"\n{len(features)} municípios casados com sucesso.")
    if missing:
        print(f"{len(missing)} cidades do banco SEM polígono municipal encontrado (primeiras 20):")
        for key in list(missing)[:20]:
            print(f"  {key}")

    fc = {"type": "FeatureCollection", "features": features}
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    print(f"\nExportado para {args.output}")


if __name__ == "__main__":
    main()
