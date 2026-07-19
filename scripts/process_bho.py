"""
process_bho.py

Input: geoft_bho_curso_dagua.gpkg — GeoPackage nacional de cursos d'água da
       BHO (Base Hidrográfica Ottocodificada), baixado de
       https://metadados.snirh.gov.br/files/32e309da-a8c1-443f-90ac-0cd79ce6a33d/geoft_bho_curso_dagua.gpkg
       (~2.9GB, Brasil inteiro — o zip regional "Atlântico Nordeste Oriental"
       citado no plano original não existe mais nesse formato).
Output: /public/geojson/hydro_nordeste.geojson

Processo:
1. Abrir o GeoPackage com geopandas já recortando pela bounding box do
   Nordeste (bbox pushdown via OGR/rtree — evita carregar os 2.9GB em memória)
2. Filtrar por classe, se a coluna existir (a camada "curso_dagua" já vem
   pré-filtrada pela própria ANA como cursos d'água, então normalmente não
   há coluna de tipo a mais para filtrar)
3. Simplificar geometria (tolerância 0.001 grau)
4. Calcular distância de cada bairro ao corpo d'água mais próximo
5. Normalizar: 0 = longe (> 5km), 1 = muito próximo (< 500m)
6. Exportar como GeoJSON

Dependências: geopandas, shapely, pyogrio (ou fiona)

Uso: python scripts/process_bho.py \
       --input dados-brutos/ana/geoft_bho_curso_dagua.gpkg \
       --neighborhoods public/geojson/neighborhoods_recife.geojson
"""

import argparse
import os

import geopandas as gpd
from shapely.ops import nearest_points

SIMPLIFY_TOLERANCE_DEG = 0.001
NEAR_THRESHOLD_KM = 0.5
FAR_THRESHOLD_KM = 5.0

# Bounding box aproximada do Nordeste (min_lon, min_lat, max_lon, max_lat),
# usada para recortar o GeoPackage nacional no próprio read_file (bbox
# pushdown), evitando carregar o Brasil inteiro em memória.
#
# Ampliado em 2026-07-19 (diagnóstico de lacunas): o bbox anterior
# (-45,-15,-35,-1) cortava os 4 lados da extensão real dos 9 estados —
# oeste do Maranhão, extremo-sul da Bahia, e a borda leste (Fernando de
# Noronha e o litoral da própria capital João Pessoa, que fica a -34,8°,
# além do limite antigo de -35,0°). O geopackage fonte cobre o Brasil
# inteiro, então não há custo de qualidade em alargar — só um pouco mais
# de tempo de leitura.
NORDESTE_BBOX = (-49.5, -19.0, -31.5, -1.5)

# Classes de corpo d'água consideradas relevantes, caso a camada tenha uma
# coluna de classificação (normalmente não tem — "curso_dagua" já é o filtro).
RELEVANT_CLASSES = ["Rio", "Canal", "Riacho"]


def load_and_filter_hydro(gpkg_path: str, bbox: tuple[float, float, float, float] = NORDESTE_BBOX) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(gpkg_path, bbox=bbox)

    # A coluna de classificação varia conforme a versão da BHO (ex: "cotrecho", "tipo", "ds_tipo").
    # A camada geoft_bho_curso_dagua normalmente não tem essa coluna (já vem
    # filtrada pela ANA), então isso só entra em ação se ela existir.
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
    parser.add_argument("--input", required=True, help="GeoPackage nacional da BHO (geoft_bho_curso_dagua.gpkg)")
    parser.add_argument("--neighborhoods", help="GeoJSON de bairros para calcular a proximidade")
    parser.add_argument(
        "--bbox",
        nargs=4,
        type=float,
        metavar=("MIN_LON", "MIN_LAT", "MAX_LON", "MAX_LAT"),
        default=list(NORDESTE_BBOX),
        help="Bounding box para recortar o GeoPackage nacional (default: Nordeste inteiro)",
    )
    parser.add_argument(
        "--cache-dir",
        default="dados-brutos/ana",
        help="Onde salvar a hidrografia recortada/simplificada (artefato intermediário, NÃO vai para public/)",
    )
    args = parser.parse_args()

    os.makedirs(args.cache_dir, exist_ok=True)
    hydro_gdf = load_and_filter_hydro(args.input, tuple(args.bbox))

    hydro_out = os.path.join(args.cache_dir, "hydro_nordeste_clipped.geojson")
    hydro_gdf.to_file(hydro_out, driver="GeoJSON")
    print(f"Hidrografia simplificada ({len(hydro_gdf)} trechos) -> {hydro_out}")

    if args.neighborhoods:
        result = compute_hydro_proximity(args.neighborhoods, hydro_gdf)
        result.to_file(args.neighborhoods, driver="GeoJSON")
        print(f"hydro_proximity adicionado em -> {args.neighborhoods}")


if __name__ == "__main__":
    main()
