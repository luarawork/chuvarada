"""
process_hydro_sergipe.py

Input: um GeoJSON com os bairros de SE já exportados do banco (gerado por
       scripts/fix_hydro_sergipe_local.js), contendo id/name/hydro_proximity
       atual/geometry.
       + dados-brutos/hidro/se_hidrografia_extracted/Hidrografia_Sergipe.shp
       (SEMARH/SRH, 2010 — baixado manualmente via serhidro.semac.se.gov.br,
       4.018 trechos de rio/córrego, EPSG:31984)

Processo: calcula a proximidade de cada bairro à hidrografia LOCAL (SEMARH)
e combina com o hydro_proximity já existente (derivado da BHO nacional)
pegando o MAIOR dos dois — mesmo princípio já usado em
process_hydro_recife.py ("mescla a base municipal com a BHO regional,
dando prioridade ao dado local onde disponível").

IMPORTANTE — por que combinar em vez de substituir: testado e confirmado
que a base da SEMARH é mais esparsa que a BHO nacional pra Sergipe (só
4.018 trechos, aparentemente só rios/canais classificados, sem a rede
densa de riachos menores que a BHO ottocodificada captura). Substituir
diretamente pioraria 150 dos 275 bairros; combinar com "o maior dos
dois" gera melhoras reais e zero pioras.

Uso: python scripts/process_hydro_sergipe.py <bairros_export.geojson> <output.json>
"""

import json
import sys
import warnings

import geopandas as gpd
from shapely.geometry import shape
from shapely.ops import nearest_points

warnings.filterwarnings("ignore", category=DeprecationWarning)

NEAR_THRESHOLD_KM = 0.5
FAR_THRESHOLD_KM = 5.0
HIDRO_SHP = "dados-brutos/hidro/se_hidrografia_extracted/Hidrografia_Sergipe.shp"


def normalize_proximity(distance_km: float) -> float:
    if distance_km <= NEAR_THRESHOLD_KM:
        return 1.0
    if distance_km >= FAR_THRESHOLD_KM:
        return 0.0
    return 1.0 - (distance_km - NEAR_THRESHOLD_KM) / (FAR_THRESHOLD_KM - NEAR_THRESHOLD_KM)


def main():
    bairros_path = sys.argv[1]
    output_path = sys.argv[2]

    with open(bairros_path, encoding="utf-8") as f:
        bairros_gj = json.load(f)

    hidro = gpd.read_file(HIDRO_SHP)
    hidro_union = hidro.geometry.union_all()

    results = []
    for feat in bairros_gj["features"]:
        props = feat["properties"]
        geom_wgs84 = gpd.GeoSeries([shape(feat["geometry"])], crs="EPSG:4326")
        geom_m = geom_wgs84.to_crs(hidro.crs).iloc[0]
        centroid = geom_m.centroid
        nearest = nearest_points(centroid, hidro_union)[1]
        distance_km = centroid.distance(nearest) / 1000
        local_hydro = normalize_proximity(distance_km)
        old_hydro = props["old_hydro"]
        combined = max(old_hydro, local_hydro)
        results.append(
            {
                "id": props["id"],
                "name": props["name"],
                "cidade": props["cidade"],
                "old_hydro": old_hydro,
                "local_hydro": local_hydro,
                "combined": combined,
            }
        )

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1)

    changed = [r for r in results if abs(r["combined"] - r["old_hydro"]) > 0.001]
    print(f"{len(results)} bairros processados, {len(changed)} com melhora real -> {output_path}")


if __name__ == "__main__":
    main()
