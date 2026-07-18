"""
process_srtm.py

Input: dados-brutos/srtm/srtm_{salvador,recife,natal}.tif — GeoTIFFs SRTMGL1
       baixados da API do OpenTopography (portal.opentopography.org),
       um por cidade, já cobrindo a bounding box de CITY_BOUNDS abaixo.
Output: /public/geojson/slope_salvador.geojson
        /public/geojson/slope_recife.geojson
        /public/geojson/slope_natal.geojson

Processo:
1. Abrir GeoTIFF com GDAL
2. Calcular declividade (slope) a partir do DEM
3. Recortar pela bounding box de cada cidade
4. Normalizar declividade: 0 = plano (maior risco), 1 = íngreme (menor risco)
5. Agregar por bairro (média da declividade dentro do polígono)
6. Exportar como GeoJSON com propriedade terrain_slope por bairro

Dependências: gdal, numpy, geopandas, rasterio

Uso: python scripts/process_srtm.py --input dados-brutos/srtm/srtm_salvador.tif --city salvador
"""

import argparse
import json
import os

import numpy as np
import geopandas as gpd
import rasterio
from rasterio.mask import mask
from rasterio.warp import calculate_default_transform, reproject, Resampling

# Bounding boxes aproximadas (min_lon, min_lat, max_lon, max_lat) das cidades foco.
CITY_BOUNDS = {
    "salvador": (-38.62, -13.05, -38.35, -12.75),
    "recife": (-35.02, -8.20, -34.80, -7.90),
    "natal": (-35.35, -5.95, -35.10, -5.65),
}

SLOPE_MAX_DEGREES = 15.0  # acima disso, consideramos declividade máxima (terreno mais seguro)


def compute_slope(dem_path: str, bounds: tuple[float, float, float, float]) -> tuple[np.ndarray, rasterio.Affine, dict]:
    """Recorta o DEM pela bounding box da cidade e calcula a declividade em graus."""
    with rasterio.open(dem_path) as src:
        window = rasterio.windows.from_bounds(*bounds, transform=src.transform)
        dem = src.read(1, window=window)
        transform = src.window_transform(window)
        profile = src.profile

    # Gradiente em x/y a partir da resolução do pixel (graus -> aproximação em metros no equador)
    pixel_size_deg = profile["transform"][0]
    pixel_size_m = pixel_size_deg * 111_320  # aproximação simples, suficiente para o Nordeste

    gy, gx = np.gradient(dem.astype("float64"), pixel_size_m)
    slope_rad = np.arctan(np.sqrt(gx**2 + gy**2))
    slope_deg = np.degrees(slope_rad)

    return slope_deg, transform, profile


def normalize_slope(slope_deg: np.ndarray) -> np.ndarray:
    """0 = terreno plano (maior risco de alagamento), 1 = terreno íngreme (menor risco)."""
    clipped = np.clip(slope_deg, 0, SLOPE_MAX_DEGREES)
    normalized = clipped / SLOPE_MAX_DEGREES
    return normalized


def aggregate_by_neighborhood(
    neighborhoods_geojson: str, slope_deg: np.ndarray, transform: rasterio.Affine, crs
) -> gpd.GeoDataFrame:
    """Calcula a média da declividade normalizada dentro do polígono de cada bairro."""
    gdf = gpd.read_file(neighborhoods_geojson)
    slope_norm = normalize_slope(slope_deg)

    # Constrói um raster temporário in-memory para permitir zonal stats com rasterio.mask
    from rasterio.io import MemoryFile

    values = []
    with MemoryFile() as memfile:
        with memfile.open(
            driver="GTiff",
            height=slope_norm.shape[0],
            width=slope_norm.shape[1],
            count=1,
            dtype=slope_norm.dtype,
            crs=crs,
            transform=transform,
        ) as dataset:
            dataset.write(slope_norm, 1)

            for geom in gdf.geometry:
                try:
                    out_image, _ = mask(dataset, [geom], crop=True)
                    valid = out_image[out_image > 0]
                    values.append(float(valid.mean()) if valid.size else 0.5)
                except ValueError:
                    values.append(0.5)  # geometria fora do raster

    gdf["terrain_slope"] = values
    return gdf


def main():
    parser = argparse.ArgumentParser(description="Processa SRTM em declividade normalizada por bairro")
    parser.add_argument("--input", required=True, help="Caminho do .tif do SRTM")
    parser.add_argument("--city", required=True, choices=CITY_BOUNDS.keys())
    parser.add_argument(
        "--neighborhoods",
        help="GeoJSON de bairros da cidade (gerado por process_neighborhoods.py) para agregação",
    )
    parser.add_argument("--output-dir", default="public/geojson")
    args = parser.parse_args()

    bounds = CITY_BOUNDS[args.city]
    slope_deg, transform, profile = compute_slope(args.input, bounds)

    os.makedirs(args.output_dir, exist_ok=True)

    if args.neighborhoods:
        # Atualiza terrain_slope in-place no mesmo GeoJSON de bairros usado
        # por process_neighborhoods.py/process_bho.py (mesma convenção dos
        # outros scripts do pipeline).
        gdf = aggregate_by_neighborhood(args.neighborhoods, slope_deg, transform, profile["crs"])
        gdf.to_file(args.neighborhoods, driver="GeoJSON")
        print(f"terrain_slope atualizado em -> {args.neighborhoods}")
    else:
        # Sem bairros ainda: salva só o raster normalizado como referência (não é o formato final).
        out_path = os.path.join(args.output_dir, f"slope_{args.city}.npy")
        np.save(out_path, normalize_slope(slope_deg))
        print(f"Declividade normalizada (raster bruto) -> {out_path}")


if __name__ == "__main__":
    main()
