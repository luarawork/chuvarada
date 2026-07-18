"""
process_bho.py

Input: shapefile BHO/ANA — Atlântico Nordeste Oriental
Output: /public/geojson/hydro_nordeste.geojson

Processo:
1. Abrir shapefile com geopandas
2. Filtrar apenas rios e canais principais
3. Simplificar geometria (tolerância 0.001 grau)
4. Calcular distância de cada bairro ao corpo d'água mais próximo
5. Normalizar: 0 = longe (> 5km), 1 = muito próximo (< 500m)
6. Exportar como GeoJSON

Dependências: geopandas, shapely

Uso: python scripts/process_bho.py --input path/to/bho.shp --neighborhoods public/geojson/neighborhoods_recife.geojson
"""

import argparse
import os

import geopandas as gpd
from shapely.ops import nearest_points

SIMPLIFY_TOLERANCE_DEG = 0.001
NEAR_THRESHOLD_KM = 0.5
FAR_THRESHOLD_KM = 5.0

# Classes de corpo d'água consideradas relevantes na BHO (rios e canais principais).
RELEVANT_CLASSES = ["Rio", "Canal", "Riacho"]


def load_and_filter_hydro(shapefile_path: str) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(shapefile_path)

    # A coluna de classificação varia conforme a versão da BHO (ex: "cotrecho", "tipo", "ds_tipo").
    # Ajustar o nome da coluna real ao receber o shapefile definitivo.
    class_column = next((c for c in gdf.columns if "tipo" in c.lower()), None)
    if class_column:
        gdf = gdf[gdf[class_column].isin(RELEVANT_CLASSES)]

    gdf["geometry"] = gdf.geometry.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
    return gdf


def normalize_proximity(distance_km: float) -> float:
    if distance_km <= NEAR_THRESHOLD_KM:
        return 1.0
    if distance_km >= FAR_THRESHOLD_KM:
        return 0.0
    # interpolação linear invertida entre os limiares
    return 1.0 - (distance_km - NEAR_THRESHOLD_KM) / (FAR_THRESHOLD_KM - NEAR_THRESHOLD_KM)


def compute_hydro_proximity(neighborhoods_path: str, hydro_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    neighborhoods = gpd.read_file(neighborhoods_path)

    # Reprojeta para um CRS métrico (SIRGAS 2000 / UTM apropriado ao Nordeste) para medir distância em km.
    neighborhoods_m = neighborhoods.to_crs(epsg=31985)
    hydro_m = hydro_gdf.to_crs(epsg=31985)
    hydro_union = hydro_m.geometry.unary_union

    proximities = []
    for geom in neighborhoods_m.geometry:
        centroid = geom.centroid
        nearest = nearest_points(centroid, hydro_union)[1]
        distance_km = centroid.distance(nearest) / 1000
        proximities.append(normalize_proximity(distance_km))

    neighborhoods["hydro_proximity"] = proximities
    return neighborhoods


def main():
    parser = argparse.ArgumentParser(description="Processa hidrografia BHO/ANA em proximidade por bairro")
    parser.add_argument("--input", required=True, help="Shapefile da BHO (Atlântico Nordeste Oriental)")
    parser.add_argument("--neighborhoods", help="GeoJSON de bairros para calcular a proximidade")
    parser.add_argument("--output-dir", default="public/geojson")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    hydro_gdf = load_and_filter_hydro(args.input)

    hydro_out = os.path.join(args.output_dir, "hydro_nordeste.geojson")
    hydro_gdf.to_file(hydro_out, driver="GeoJSON")
    print(f"Hidrografia simplificada -> {hydro_out}")

    if args.neighborhoods:
        result = compute_hydro_proximity(args.neighborhoods, hydro_gdf)
        result.to_file(args.neighborhoods, driver="GeoJSON")
        print(f"hydro_proximity adicionado em -> {args.neighborhoods}")


if __name__ == "__main__":
    main()
