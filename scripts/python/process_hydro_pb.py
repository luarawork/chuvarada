"""
process_hydro_pb.py

Input: um GeoJSON com os bairros da PB já exportados do banco (gerado por
       scripts/one-off/fix_hydro_pb_local.js), contendo id/name/hydro_proximity
       atual/geometry.
       + dados-brutos/hidro/pb_drenagem_extracted/Drenagem_Principal.shp
       (AESA, 2.266 trechos, EPSG:4618, tem CodigoOtto -- mesma codificação
       ottobacia da BHO nacional, indicando que é a rede oficial "principal")
       + dados-brutos/hidro/pb_rios_extracted/_rios da PARAIBA_.shp
       (AESA, 31.420 trechos, EPSG:4674, rede bem mais densa)

Processo: calcula a proximidade de cada bairro à hidrografia LOCAL (união
das duas fontes AESA/PB) e combina com o hydro_proximity já existente
(derivado da BHO nacional) pegando o MAIOR dos dois -- mesmo princípio já
usado em process_hydro_recife.py e process_hydro_sergipe.py.

Por que usar as duas fontes combinadas em vez de só uma: testado
empiricamente (551 bairros da PB) -- Drenagem_Principal sozinha melhora
92 bairros, "_rios da PARAIBA_" sozinha melhora 167, e a união das duas
melhora 168 (a rede mais densa já cobre quase tudo que a principal cobre,
mas juntar as duas nunca piora nada, é estritamente >= usar só uma).

Uso: python scripts/python/process_hydro_pb.py <bairros_export.geojson> <output.json>
"""

import json
import sys
import warnings

import geopandas as gpd
from shapely.geometry import shape
from shapely.ops import nearest_points, unary_union

warnings.filterwarnings("ignore", category=DeprecationWarning)

NEAR_THRESHOLD_KM = 0.5
FAR_THRESHOLD_KM = 5.0
TARGET_CRS = "EPSG:31984"  # SIRGAS2000 / UTM zone 24S -- mesma usada pra Sergipe
DRENAGEM_SHP = "dados-brutos/hidro/pb_drenagem_extracted/Drenagem_Principal.shp"
RIOS_SHP = "dados-brutos/hidro/pb_rios_extracted/_rios da PARAIBA_.shp"


def normalize_proximity(distance_km: float) -> float:
    if distance_km <= NEAR_THRESHOLD_KM:
        return 1.0
    if distance_km >= FAR_THRESHOLD_KM:
        return 0.0
    return 1.0 - (distance_km - NEAR_THRESHOLD_KM) / (FAR_THRESHOLD_KM - NEAR_THRESHOLD_KM)


def load_hydro_union():
    parts = []
    for path in (DRENAGEM_SHP, RIOS_SHP):
        gdf = gpd.read_file(path)
        gdf = gdf[gdf.geometry.notna() & gdf.geometry.is_valid]
        parts.append(gdf.to_crs(TARGET_CRS).geometry.union_all())
    return unary_union(parts)


def main():
    bairros_path = sys.argv[1]
    output_path = sys.argv[2]

    with open(bairros_path, encoding="utf-8") as f:
        bairros_gj = json.load(f)

    hydro_union = load_hydro_union()

    results = []
    for feat in bairros_gj["features"]:
        props = feat["properties"]
        geom_wgs84 = gpd.GeoSeries([shape(feat["geometry"])], crs="EPSG:4326")
        geom_m = geom_wgs84.to_crs(TARGET_CRS).iloc[0]
        centroid = geom_m.centroid
        nearest = nearest_points(centroid, hydro_union)[1]
        distance_km = centroid.distance(nearest) / 1000
        local_hydro = normalize_proximity(distance_km)
        old_hydro = props["old_hydro"] or 0.0
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
