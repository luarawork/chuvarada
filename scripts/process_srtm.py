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
import warnings

import numpy as np
import geopandas as gpd
import rasterio
from rasterio.mask import mask
from rasterio.warp import calculate_default_transform, reproject, Resampling

# rasterio.read(window=...) aciona um DeprecationWarning de reshape do NumPy
# 2.5 em toda leitura de janela — inofensivo (é assim que a lib recorta), só
# some quando o rasterio atualizar. Silenciado aqui pra não afogar o log
# quando processamos milhares de bairros em modo estadual.
warnings.filterwarnings("ignore", category=DeprecationWarning)

# Bounding boxes aproximadas (min_lon, min_lat, max_lon, max_lat) das cidades foco.
CITY_BOUNDS = {
    "salvador": (-38.62, -13.05, -38.35, -12.75),
    "recife": (-35.02, -8.20, -34.80, -7.90),
    "natal": (-35.35, -5.95, -35.10, -5.65),
    "fortaleza": (-38.7, -3.9, -38.3, -3.6),
    "maceio": (-35.9, -9.8, -35.6, -9.5),
    "aracaju": (-37.2, -11.1, -37.0, -10.8),
    "joaopessoa": (-35.0, -7.3, -34.7, -6.9),
    "saoluis": (-44.4, -2.7, -44.1, -2.4),
    "teresina": (-42.9, -5.2, -42.7, -4.9),
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


def aggregate_by_neighborhood_windowed(dem_path: str, neighborhoods_geojson: str) -> gpd.GeoDataFrame:
    """Igual a aggregate_by_neighborhood, mas pra estados inteiros: em vez de
    carregar o DEM inteiro em memória de uma vez (Bahia inteira em float64
    passaria de 9GB), lê uma janela pequena por bairro (bbox + margem pra não
    cortar o gradiente na borda), calcula a declividade só ali, e descarta.
    Mantém só uma janela pequena em memória por vez."""
    gdf = gpd.read_file(neighborhoods_geojson)
    values = []

    with rasterio.open(dem_path) as src:
        pixel_size_deg = src.transform[0]
        pixel_size_m = pixel_size_deg * 111_320
        margin_deg = pixel_size_deg * 2  # margem de 2px pro gradiente não cortar na borda

        for geom in gdf.geometry:
            try:
                minx, miny, maxx, maxy = geom.bounds
                window = rasterio.windows.from_bounds(
                    minx - margin_deg, miny - margin_deg, maxx + margin_deg, maxy + margin_deg,
                    transform=src.transform,
                )
                dem_window = src.read(1, window=window)
                if dem_window.size == 0:
                    values.append(0.5)
                    continue

                window_transform = src.window_transform(window)
                gy, gx = np.gradient(dem_window.astype("float32"), pixel_size_m)
                slope_rad = np.arctan(np.sqrt(gx**2 + gy**2))
                slope_norm = normalize_slope(np.degrees(slope_rad))

                from rasterio.io import MemoryFile

                with MemoryFile() as memfile:
                    with memfile.open(
                        driver="GTiff",
                        height=slope_norm.shape[0],
                        width=slope_norm.shape[1],
                        count=1,
                        dtype=slope_norm.dtype,
                        crs=src.crs,
                        transform=window_transform,
                    ) as dataset:
                        dataset.write(slope_norm, 1)
                        out_image, _ = mask(dataset, [geom], crop=True)
                        valid = out_image[out_image > 0]
                        values.append(float(valid.mean()) if valid.size else 0.5)
            except (ValueError, IndexError):
                values.append(0.5)  # geometria fora do raster ou janela vazia

    gdf["terrain_slope"] = values
    return gdf


def main():
    parser = argparse.ArgumentParser(description="Processa SRTM em declividade normalizada por bairro")
    parser.add_argument("--input", required=True, help="Caminho do .tif do SRTM")
    parser.add_argument("--city", choices=CITY_BOUNDS.keys(), help="Cidade específica (usa CITY_BOUNDS)")
    parser.add_argument(
        "--state",
        help="Processa um estado inteiro (janela por bairro em vez de carregar o DEM inteiro em memória)",
    )
    parser.add_argument(
        "--neighborhoods",
        help="GeoJSON de bairros da cidade/estado (gerado por process_neighborhoods.py ou "
        "process_state_neighborhoods.py) para agregação",
    )
    parser.add_argument("--output-dir", default="public/geojson")
    args = parser.parse_args()

    if not args.city and not args.state:
        raise SystemExit("Especifique --city ou --state")

    os.makedirs(args.output_dir, exist_ok=True)

    if args.state:
        if not args.neighborhoods:
            raise SystemExit("--neighborhoods é obrigatório com --state")
        gdf = aggregate_by_neighborhood_windowed(args.input, args.neighborhoods)
        gdf.to_file(args.neighborhoods, driver="GeoJSON")
        print(f"terrain_slope atualizado (modo estadual, janela por bairro) em -> {args.neighborhoods}")
        return

    bounds = CITY_BOUNDS[args.city]
    slope_deg, transform, profile = compute_slope(args.input, bounds)

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
