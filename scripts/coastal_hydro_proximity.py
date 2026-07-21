"""
coastal_hydro_proximity.py

Calcula hydro_proximity usando distância à LINHA DE COSTA (não a rios)
para bairros costeiros que ficaram com hydro_proximity=0 -- a BHO
(geoft_bho_curso_dagua.gpkg) classifica oceano/baía/estuário como algo
diferente de "curso_dagua", então bairros claramente à beira-mar (ex:
Santos-SP, Rio de Janeiro-RJ) não encontram nenhum curso d'água próximo
mesmo estando na água. Complementa (não substitui) o cálculo por rio já
feito em process_bho.py -- ver diagnostico_cobertura_sul_sudeste.md.

Usa a linha de costa nacional já baixada (geoft_bho_linha_costa.gpkg,
~23 trechos -- dataset propositalmente simplificado, não captura toda
reentrância de baía complexa, ver limitação abaixo).

Input: JSON com lista de {"id", "geometry"} (GeoJSON geometry, EPSG:4674)
Output: JSON com {"id", "distance_km", "hydro_proximity_costa"} por feature.

Limitação conhecida: em baías complexas (ex: Vitória-ES), a linha de
costa simplificada pode não ter nenhum trecho próximo ao ponto real,
dando uma distância muito maior que a real (dezenas a centenas de km).
Descarte manualmente qualquer resultado com distance_km implausível
(>20km) antes de aplicar -- não é uma distância real, é limitação do
dataset.

Uso:
  python scripts/coastal_hydro_proximity.py <input.json> <output.json>
"""

import json
import sys

import geopandas as gpd
from shapely import STRtree
from shapely.geometry import shape

sys.path.insert(0, "scripts")
from process_bho import normalize_proximity

COASTLINE_PATH = "dados-brutos/ana/geoft_bho_linha_costa.gpkg"
# SIRGAS 2000 / Brasil Policonica -- mesma projeção usada no cálculo
# nacional de hydro_proximity (ver diagnóstico), preserva distância
# razoavelmente em qualquer ponto do Brasil, não só perto de 1 meridiano.
CRS_METRIC = "EPSG:5880"


def main():
    input_path, output_path = sys.argv[1], sys.argv[2]
    with open(input_path, encoding="utf-8") as f:
        features = json.load(f)

    coastline = gpd.read_file(COASTLINE_PATH).to_crs(CRS_METRIC)
    tree = STRtree(coastline.geometry.values)
    print(f"STRtree construida sobre {len(coastline)} trechos de linha de costa.")

    results = []
    for feat in features:
        geom = shape(feat["geometry"])
        gdf = gpd.GeoDataFrame(geometry=[geom], crs="EPSG:4674").to_crs(CRS_METRIC)
        centroid = gdf.geometry.iloc[0].centroid
        idx = tree.nearest(centroid)
        nearest = coastline.geometry.values[idx]
        distance_km = centroid.distance(nearest) / 1000
        proximity = normalize_proximity(distance_km)
        results.append({"id": feat["id"], "distance_km": round(distance_km, 3), "hydro_proximity_costa": proximity})
        print(f"{feat['id']}: {distance_km:.3f}km -> proximity={proximity:.3f}")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
