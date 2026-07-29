"""
process_hydro_mg.py

Input: um GeoJSON com os bairros de MG já exportados do banco (gerado por
       scripts/one-off/fix_hydro_mg_local.js), contendo id/name/hydro_proximity
       atual/geometry.
       + dados-brutos/hidro/mg/extracted/ide_0104_mg_hidrografia_principal_lin.shp
       (IGAM/IDE-Sisema, "Principais trechos hidrográficos de Minas Gerais",
       baixado via WFS de geoserver.meioambiente.mg.gov.br em 28/07/2026,
       89.911 trechos, EPSG:4674)

Processo: calcula a proximidade de cada bairro à hidrografia LOCAL (IGAM) e
combina com o hydro_proximity já existente (derivado da BHO nacional)
pegando o MAIOR dos dois -- mesmo princípio já usado em
process_hydro_recife.py/process_hydro_sergipe.py/process_hydro_pb.py.

Uso: python scripts/python/process_hydro_mg.py <bairros_export.geojson> <output.json>
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
TARGET_CRS = "EPSG:31983"  # SIRGAS2000 / UTM zone 23S -- cobre o centro de MG
HIDRO_SHP = "dados-brutos/hidro/mg/extracted/ide_0104_mg_hidrografia_principal_lin.shp"


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
    hidro = hidro[hidro.geometry.notna() & hidro.geometry.is_valid]
    hidro_union = hidro.to_crs(TARGET_CRS).geometry.union_all()

    results = []
    for feat in bairros_gj["features"]:
        props = feat["properties"]
        geom_wgs84 = gpd.GeoSeries([shape(feat["geometry"])], crs="EPSG:4326")
        geom_m = geom_wgs84.to_crs(TARGET_CRS).iloc[0]
        centroid = geom_m.centroid
        nearest = nearest_points(centroid, hidro_union)[1]
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
