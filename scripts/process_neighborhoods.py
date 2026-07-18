"""
process_neighborhoods.py

Input: shapefile de SETORES CENSITÁRIOS do IBGE (Censo 2022), por estado —
       ex: BA_setores_CD2022.shp, PE_setores_CD2022.shp, RN_setores_CD2022.shp
       (baixados de https://geoftp.ibge.gov.br/.../censo_2022/setores/shp/UF/).
       Cada estado tem todos os municípios juntos e cada bairro é fragmentado
       em vários setores censitários — por isso este script filtra pelo
       município alvo (campo NM_MUN) e faz dissolve por bairro (NM_BAIRRO)
       para virar um polígono por bairro.
Output: /public/geojson/neighborhoods_salvador.geojson
        /public/geojson/neighborhoods_recife.geojson
        /public/geojson/neighborhoods_natal.geojson

Processo:
1. Abrir shapefile de setores censitários com geopandas
2. Filtrar pelo município alvo (NM_MUN) e descartar setores sem bairro (NM_BAIRRO vazio)
3. Dissolve: unir os setores de cada bairro em um único polígono
4. Simplificar a geometria resultante (para performance no Leaflet)
5. Marcar bairros costeiros (is_coastal = true se dentro de 2km do mar)
6. Exportar como GeoJSON com terrain_slope/hydro_proximity placeholder (0.5/0.0)
7. Opcionalmente fazer upload para Supabase (tabela neighborhoods)

IMPORTANTE — ordem real de execução (diferente da ordem original do plano):
este script roda PRIMEIRO, pois é ele que cria o polígono por bairro.
process_srtm.py e process_bho.py/process_hydro_recife.py rodam DEPOIS,
apontando --neighborhoods para o arquivo gerado aqui, e o atualizam in-place
preenchendo terrain_slope e hydro_proximity de verdade:
  1. process_neighborhoods.py     (cria os polígonos por bairro)
  2. process_srtm.py              (preenche terrain_slope)
  3. process_bho.py               (preenche hydro_proximity regional)
  4. process_hydro_recife.py      (refina hydro_proximity local, só Recife)

Dependências: geopandas, shapely, supabase (pip install supabase)

Uso:
  python scripts/process_neighborhoods.py \
    --input dados-brutos/ibge/ba/BA_setores_CD2022.shp \
    --municipality Salvador --city-name Salvador --city-id <uuid> \
    --coastline dados-brutos/ana/geoft_bho_linha_costa.gpkg \
    --simplify-tolerance 0.0005
"""

import argparse
import json
import os

import geopandas as gpd

SIMPLIFY_TOLERANCE_DEFAULT = 0.0005
COASTAL_DISTANCE_KM = 2.0


def filter_and_dissolve(
    gdf: gpd.GeoDataFrame,
    municipality: str,
    municipality_column: str,
    name_column: str,
) -> gpd.GeoDataFrame:
    """Filtra os setores censitários do município alvo e une (dissolve) os
    setores de cada bairro em um único polígono."""
    mask = gdf[municipality_column].astype(str).str.strip().str.upper() == municipality.strip().upper()
    city_gdf = gdf[mask].copy()

    if city_gdf.empty:
        available = sorted(gdf[municipality_column].dropna().unique().tolist())
        raise SystemExit(
            f'Nenhum setor encontrado para município "{municipality}" na coluna '
            f'{municipality_column}. Municípios disponíveis (amostra): {available[:20]}'
        )

    city_gdf = city_gdf[city_gdf[name_column].astype(str).str.strip() != ""]
    dissolved = city_gdf.dissolve(by=name_column, as_index=False)
    return dissolved


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
    parser = argparse.ArgumentParser(description="Processa setores censitários IBGE em bairros (GeoJSON)")
    parser.add_argument("--input", required=True, help="Shapefile de setores censitários IBGE (por estado)")
    parser.add_argument("--municipality", required=True, help='Nome do município a filtrar, ex: "Salvador"')
    parser.add_argument("--city-name", required=True, help="Nome da cidade para a propriedade `city` no GeoJSON")
    parser.add_argument("--city-id", help="UUID da cidade em `cities` (necessário para upload)")
    parser.add_argument("--municipality-column", default="NM_MUN", help="Coluna com o nome do município no shapefile")
    parser.add_argument("--name-column", default="NM_BAIRRO", help="Coluna com o nome do bairro no shapefile")
    parser.add_argument("--coastline", help="Camada de linha de costa (shp/gpkg) para marcar is_coastal")
    parser.add_argument("--simplify-tolerance", type=float, default=SIMPLIFY_TOLERANCE_DEFAULT)
    parser.add_argument("--output-dir", default="public/geojson")
    parser.add_argument("--upload", action="store_true", help="Envia os bairros processados para o Supabase")
    args = parser.parse_args()

    gdf = gpd.read_file(args.input)
    dissolved = filter_and_dissolve(gdf, args.municipality, args.municipality_column, args.name_column)
    dissolved = simplify_geometries(dissolved, args.simplify_tolerance)
    dissolved = mark_coastal(dissolved, args.coastline)
    output = build_output_gdf(dissolved, args.city_name, args.name_column)

    os.makedirs(args.output_dir, exist_ok=True)
    slug = args.city_name.lower().replace(" ", "_")
    out_path = os.path.join(args.output_dir, f"neighborhoods_{slug}.geojson")
    output.to_file(out_path, driver="GeoJSON")
    print(f"{len(output)} bairros de {args.city_name} processados -> {out_path}")

    if args.upload:
        if not args.city_id:
            raise SystemExit("--city-id é obrigatório para --upload")
        upload_to_supabase(output, args.city_id)


if __name__ == "__main__":
    main()
