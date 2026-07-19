"""
process_state_neighborhoods.py

Expansão de cobertura: processa um shapefile de setores censitários do IBGE
(Censo 2022) para o ESTADO INTEIRO, não só a capital — ao contrário de
process_neighborhoods.py (que filtra um único --municipality).

Input: shapefile de setores censitários do IBGE, por estado
       (ex: dados-brutos/ibge/ba/BA_setores_CD2022.shp).
       IMPORTANTE: o .cpg desses shapefiles diz "UTF-8" mas o DBF real está
       em Latin-1 (confirmado inspecionando acentos corrompidos) — por isso
       lemos sempre com encoding="latin1" explícito, ignorando o .cpg.
Output: /public/geojson/neighborhoods_state_{uf}.geojson — todos os bairros
        dissolvidos do estado inteiro, um GeoJSON só, com propriedade `city`
        (nome do município) para o script de upload agrupar depois.
        /public/geojson/state_{uf}_municipios.json — metadados por município
        (usado depois para decidir data_level e criar linhas em `cities`).

Nomeação de bairro (setores do interior costumam não ter NM_BAIRRO):
  1. NM_BAIRRO
  2. NM_SUBDIST (subdistrito)
  3. NM_DIST (distrito)
  4. NM_MUN + " - Setor " + CD_SETOR (fallback final, raramente necessário —
     NM_DIST está presente em 100% dos setores nos 3 estados testados)

Dissolve: setores são unidos por (NM_MUN, nome_resolvido) — o nome sozinho
não basta porque bairros de municípios diferentes podem ter o mesmo nome
(ex: "Centro" existe em dezenas de municípios).

Dependências: geopandas, shapely, pyogrio

Uso:
  python scripts/process_state_neighborhoods.py \
    --input dados-brutos/ibge/ba/BA_setores_CD2022.shp \
    --state-code ba \
    --coastline dados-brutos/ana/geoft_bho_linha_costa.gpkg
"""

import argparse
import json
import os

import geopandas as gpd
import pandas as pd

SIMPLIFY_TOLERANCE_DEFAULT = 0.0005
COASTAL_DISTANCE_KM = 2.0


def fix_mojibake(value: str) -> str:
    """Alguns nomes (município/bairro/distrito) nesses shapefiles do IBGE
    vêm gravados como UTF-8 bruto DENTRO de um DBF que é Latin-1 no resto —
    ex: "Luís" grava í como os bytes 0xC3 0xAD (UTF-8), que lidos como
    Latin-1 (encoding real do arquivo, ver load_and_resolve) viram "Ã" +
    hífen-suave em vez de "í". Reencodar como Latin-1 e decodar como UTF-8
    desfaz exatamente essa dupla-codificação. Em nomes que já estavam certos
    em Latin-1 (ex: "Ilhéus", "Valença"), esse round-trip falha com
    UnicodeDecodeError (os bytes não formam UTF-8 válido) e mantemos o
    original — não há risco de estragar nomes que já estavam corretos."""
    if not isinstance(value, str):
        return value
    try:
        return value.encode("latin1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return value


def resolve_name_and_source(row) -> tuple[str, str]:
    """Aplica a cadeia de fallback NM_BAIRRO -> NM_SUBDIST -> NM_DIST -> setor.
    Retorna (nome_resolvido, fonte) — fonte serve pra reportar quantos
    municípios/bairros vieram de cada nível depois."""
    for col, source in [("NM_BAIRRO", "bairro"), ("NM_SUBDIST", "subdistrito"), ("NM_DIST", "distrito")]:
        value = row[col]
        if pd.notna(value) and str(value).strip() != "":
            return str(value).strip(), source
    return f"{row['NM_MUN']} - Setor {row['CD_SETOR']}", "setor"


def load_and_resolve(input_path: str) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(input_path, encoding="latin1")
    gdf["NM_MUN"] = gdf["NM_MUN"].astype(str).str.strip()

    for col in ["NM_MUN", "NM_BAIRRO", "NM_SUBDIST", "NM_DIST"]:
        gdf[col] = gdf[col].apply(fix_mojibake)

    resolved = gdf.apply(resolve_name_and_source, axis=1, result_type="expand")
    gdf["resolved_name"] = resolved[0]
    gdf["name_source"] = resolved[1]
    return gdf


def dissolve_by_municipality_and_name(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Une os setores de cada (município, bairro/distrito) em um único polígono.
    Mantém name_source do primeiro setor do grupo (todos os setores fundidos
    aqui compartilham o mesmo nome resolvido, então a fonte é a mesma)."""
    dissolved = gdf.dissolve(by=["NM_MUN", "resolved_name"], as_index=False, aggfunc={"name_source": "first"})
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
    coastline_union = coastline.geometry.union_all()

    # Distância do POLÍGONO INTEIRO (não do centroide) até a costa. Bairros
    # urbanos pequenos dão quase no mesmo resultado dos dois jeitos, mas os
    # municípios do interior/fallback (um polígono só cobrindo o município
    # inteiro, às vezes bem grande) podem ter sede/centroide longe da costa
    # mesmo tocando o litoral numa borda do território — centroide subestimaria
    # esses casos. GeoSeries.distance é vetorizado (roda pra série toda de
    # uma vez, não precisa de loop Python por bairro).
    distances_km = gdf_m.geometry.distance(coastline_union) / 1000
    gdf["is_coastal"] = (distances_km <= COASTAL_DISTANCE_KM).values
    return gdf


def build_output_gdf(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    output = gpd.GeoDataFrame(
        {
            "name": gdf["resolved_name"],
            "city": gdf["NM_MUN"],
            "name_source": gdf["name_source"],
            "terrain_slope": 0.5,
            "hydro_proximity": 0.0,
            "is_coastal": gdf["is_coastal"],
            "geometry": gdf.geometry,
        },
        crs=gdf.crs,
    )
    return output


def build_municipality_manifest(output: gpd.GeoDataFrame, state_code: str) -> list[dict]:
    manifest = []
    for city_name, group in output.groupby("city"):
        used_real_bairro = (group["name_source"] == "bairro").any()
        manifest.append(
            {
                "name": city_name,
                "state_code": state_code.upper(),
                "neighborhood_count": len(group),
                "is_coastal": bool(group["is_coastal"].any()),
                "used_real_bairro": bool(used_real_bairro),
            }
        )
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Processa setores censitários IBGE em bairros para um estado inteiro")
    parser.add_argument("--input", required=True, help="Shapefile de setores censitários IBGE (por estado)")
    parser.add_argument("--state-code", required=True, help="Sigla do estado, ex: ba, pe, rn (usado nos nomes de arquivo)")
    parser.add_argument("--coastline", help="Camada de linha de costa (shp/gpkg) para marcar is_coastal")
    parser.add_argument("--simplify-tolerance", type=float, default=SIMPLIFY_TOLERANCE_DEFAULT)
    parser.add_argument("--output-dir", default="public/geojson")
    args = parser.parse_args()

    print(f"Lendo {args.input} (encoding latin1, ignorando .cpg incorreto)...")
    gdf = load_and_resolve(args.input)
    print(f"{len(gdf)} setores lidos, {gdf['NM_MUN'].nunique()} municípios.")

    print("Dissolvendo setores por (município, nome resolvido)...")
    dissolved = dissolve_by_municipality_and_name(gdf)
    print(f"{len(dissolved)} polígonos de bairro/distrito após dissolve.")

    dissolved = simplify_geometries(dissolved, args.simplify_tolerance)
    dissolved = mark_coastal(dissolved, args.coastline)
    output = build_output_gdf(dissolved)

    os.makedirs(args.output_dir, exist_ok=True)
    out_path = os.path.join(args.output_dir, f"neighborhoods_state_{args.state_code}.geojson")
    output.to_file(out_path, driver="GeoJSON")
    print(f"{len(output)} bairros/distritos processados -> {out_path}")

    manifest = build_municipality_manifest(output, args.state_code)
    manifest_path = os.path.join(args.output_dir, f"state_{args.state_code}_municipios.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"{len(manifest)} municípios -> {manifest_path}")


if __name__ == "__main__":
    main()
