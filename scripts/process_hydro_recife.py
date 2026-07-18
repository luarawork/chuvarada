"""
process_hydro_recife.py

Input: dados-brutos/recife/faixas-marginais-dos-recursos-hidricos.geojson
       (portal de dados abertos do Recife — Secretaria de Meio Ambiente).
       São polígonos de faixa marginal (buffer de proteção) ao redor dos
       rios/canais do Recife, não só as linhas de centro — o dataset
       original citado no plano (recursos_hidricos.geojson) não existe mais
       nesse portal; este foi encontrado via busca na API do CKAN e tem
       atributos "nome" (nome do rio) e "bacia".
Output: /public/geojson/hydro_recife_local.geojson

Processo similar ao process_bho.py mas com dado local mais preciso.
Mescla com a camada BHO (process_bho.py) para Recife ter a camada mais rica possível:
onde houver hidrografia municipal, ela tem prioridade sobre a BHO regional
(mais detalhe = distâncias mais realistas nas ruas e canais urbanos).

Dependências: geopandas, shapely

Uso: python scripts/process_hydro_recife.py \
       --input dados-brutos/recife/faixas-marginais-dos-recursos-hidricos.geojson \
       --bho public/geojson/hydro_nordeste.geojson \
       --neighborhoods public/geojson/neighborhoods_recife.geojson
"""

import argparse
import os

import geopandas as gpd

from process_bho import (
    SIMPLIFY_TOLERANCE_DEG,
    normalize_proximity,
)
from shapely.ops import nearest_points


def load_local_hydro(shapefile_path: str) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(shapefile_path)
    gdf["geometry"] = gdf.geometry.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
    return gdf


def merge_with_bho(local_gdf: gpd.GeoDataFrame, bho_geojson_path: str) -> gpd.GeoDataFrame:
    """Combina a camada municipal (mais precisa) com a BHO regional como complemento
    fora da área coberta pelo dado municipal."""
    bho_gdf = gpd.read_file(bho_geojson_path)
    local_union = local_gdf.geometry.unary_union
    bho_outside = bho_gdf[~bho_gdf.geometry.intersects(local_union.buffer(0.001))]
    combined = gpd.GeoDataFrame(
        gpd.pd.concat([local_gdf, bho_outside], ignore_index=True), crs=local_gdf.crs
    )
    return combined


def compute_hydro_proximity(neighborhoods_path: str, hydro_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    neighborhoods = gpd.read_file(neighborhoods_path)
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
    parser = argparse.ArgumentParser(description="Processa hidrografia municipal do Recife")
    parser.add_argument(
        "--input",
        required=True,
        help="GeoJSON de faixas marginais dos recursos hídricos do Recife (portal de dados abertos)",
    )
    parser.add_argument("--bho", required=True, help="hydro_nordeste.geojson gerado por process_bho.py")
    parser.add_argument("--neighborhoods", help="neighborhoods_recife.geojson para recalcular hydro_proximity")
    parser.add_argument("--output-dir", default="public/geojson")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    local_gdf = load_local_hydro(args.input)
    combined = merge_with_bho(local_gdf, args.bho)

    out_path = os.path.join(args.output_dir, "hydro_recife_local.geojson")
    combined.to_file(out_path, driver="GeoJSON")
    print(f"Hidrografia municipal do Recife mesclada com BHO -> {out_path}")

    if args.neighborhoods:
        result = compute_hydro_proximity(args.neighborhoods, combined)
        result.to_file(args.neighborhoods, driver="GeoJSON")
        print(f"hydro_proximity (precisão local) atualizado em -> {args.neighborhoods}")


if __name__ == "__main__":
    main()
