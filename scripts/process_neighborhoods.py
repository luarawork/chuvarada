"""
process_neighborhoods.py

Input: shapefiles de bairros IBGE para Salvador, Recife e Natal
Output: /public/geojson/neighborhoods_salvador.geojson
        /public/geojson/neighborhoods_recife.geojson
        /public/geojson/neighborhoods_natal.geojson

Processo:
1. Abrir shapefile com geopandas
2. Simplificar geometria dos polígonos (para performance no Leaflet)
3. Adicionar propriedades: name, city, terrain_slope (do process_srtm),
   hydro_proximity (do process_bho / process_hydro_recife)
4. Marcar bairros costeiros (is_coastal = true se dentro de 2km do mar)
5. Exportar como GeoJSON
6. Fazer upload para Supabase (tabela neighborhoods + Storage)

Este é o último script da cadeia — depende dos GeoJSONs gerados por:
  1. process_srtm.py            (terrain_slope)
  2. process_bho.py              (hydro_proximity regional)
  3. process_hydro_recife.py     (hydro_proximity local, Recife)

Dependências: geopandas, shapely, supabase (pip install supabase)

Uso:
  python scripts/process_neighborhoods.py \
    --input path/to/bairros_salvador.shp --city-name Salvador --city-id <uuid> \
    --coastline path/to/linha_costa.shp \
    --simplify-tolerance 0.0005
"""

import argparse
import json
import os

import geopandas as gpd

SIMPLIFY_TOLERANCE_DEFAULT = 0.0005
COASTAL_DISTANCE_KM = 2.0


def simplify_geometries(gdf: gpd.GeoDataFrame, tolerance: float) -> gpd.GeoDataFrame:
    gdf["geometry"] = gdf.geometry.simplify(tolerance, preserve_topology=True)
    return gdf


def mark_coastal(gdf: gpd.GeoDataFrame, coastline_path: str | None) -> gpd.GeoDataFrame:
    if not coastline_path:
        gdf["is_coastal"] = False
        return gdf

    coastline = gpd.read_file(coastline_path).to_crs(epsg=31985)
    gdf_m = gdf.to_crs(epsg=31985)
    coastline_union = coastline.geometry.unary_union

    is_coastal = []
    for geom in gdf_m.geometry:
        distance_km = geom.centroid.distance(coastline_union) / 1000
        is_coastal.append(distance_km <= COASTAL_DISTANCE_KM)

    gdf["is_coastal"] = is_coastal
    return gdf


def build_output_gdf(
    gdf: gpd.GeoDataFrame,
    city_name: str,
    name_column: str,
) -> gpd.GeoDataFrame:
    output = gpd.GeoDataFrame(
        {
            "name": gdf[name_column],
            "city": city_name,
            "terrain_slope": gdf.get("terrain_slope", 0.5),
            "hydro_proximity": gdf.get("hydro_proximity", 0.0),
            "is_coastal": gdf["is_coastal"],
            "geometry": gdf.geometry,
        },
        crs=gdf.crs,
    )
    return output


def upload_to_supabase(gdf: gpd.GeoDataFrame, city_id: str) -> None:
    """Insere cada bairro na tabela `neighborhoods` do Supabase.
    Requer as env vars NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
    (a service role é necessária pois neighborhoods não tem policy de insert público).
    """
    from supabase import create_client

    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    client = create_client(url, key)

    rows = []
    for _, row in gdf.iterrows():
        rows.append(
            {
                "city_id": city_id,
                "name": row["name"],
                "geometry": json.loads(gpd.GeoSeries([row.geometry]).to_json())["features"][0]["geometry"],
                "terrain_slope": float(row["terrain_slope"]),
                "hydro_proximity": float(row["hydro_proximity"]),
                "is_coastal": bool(row["is_coastal"]),
            }
        )

    client.table("neighborhoods").insert(rows).execute()
    print(f"{len(rows)} bairros inseridos no Supabase para city_id={city_id}")


def main():
    parser = argparse.ArgumentParser(description="Processa bairros IBGE em GeoJSON final")
    parser.add_argument("--input", required=True, help="Shapefile de bairros IBGE")
    parser.add_argument("--city-name", required=True)
    parser.add_argument("--city-id", help="UUID da cidade em `cities` (necessário para upload)")
    parser.add_argument("--name-column", default="NM_BAIRRO", help="Coluna com o nome do bairro no shapefile")
    parser.add_argument("--coastline", help="Shapefile de linha de costa para marcar is_coastal")
    parser.add_argument("--simplify-tolerance", type=float, default=SIMPLIFY_TOLERANCE_DEFAULT)
    parser.add_argument("--output-dir", default="public/geojson")
    parser.add_argument("--upload", action="store_true", help="Envia os bairros processados para o Supabase")
    args = parser.parse_args()

    gdf = gpd.read_file(args.input)
    gdf = simplify_geometries(gdf, args.simplify_tolerance)
    gdf = mark_coastal(gdf, args.coastline)
    output = build_output_gdf(gdf, args.city_name, args.name_column)

    os.makedirs(args.output_dir, exist_ok=True)
    slug = args.city_name.lower().replace(" ", "_")
    out_path = os.path.join(args.output_dir, f"neighborhoods_{slug}.geojson")
    output.to_file(out_path, driver="GeoJSON")
    print(f"Bairros de {args.city_name} processados -> {out_path}")

    if args.upload:
        if not args.city_id:
            raise SystemExit("--city-id é obrigatório para --upload")
        upload_to_supabase(output, args.city_id)


if __name__ == "__main__":
    main()
