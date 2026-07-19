"""
compute_slope_for_geometries.py

Calcula terrain_slope (declividade normalizada, 0=plano/maior risco,
1=íngreme/menor risco) para uma lista arbitrária de polígonos de bairro,
usando janela de leitura por geometria (não carrega o raster inteiro) — a
mesma técnica de scripts/process_srtm.py:aggregate_by_neighborhood_windowed,
extraída aqui para reaproveitar em correções pontuais (bairros fora do bbox
originalmente processado, ou não cobertos pelo raster estadual).

Input: JSON com uma lista de {"id", "name", "geometry"} (GeoJSON geometry) e
       o caminho de um GeoTIFF SRTM que cubra a área.
Output: JSON com {"id", "name", "terrain_slope", "error"} por feature.

Uso:
  python scripts/compute_slope_for_geometries.py <input.json> <dem.tif> <output.json>
"""

import json
import sys
import warnings

import numpy as np
import rasterio
from rasterio.mask import mask
from rasterio.io import MemoryFile
from shapely.geometry import shape

warnings.filterwarnings("ignore", category=DeprecationWarning)

SLOPE_MAX_DEGREES = 15.0


def normalize_slope(slope_deg: np.ndarray) -> np.ndarray:
    return np.clip(slope_deg, 0, SLOPE_MAX_DEGREES) / SLOPE_MAX_DEGREES


def compute_for_geometry(dem_path: str, geom, margin_px: int = 2):
    with rasterio.open(dem_path) as src:
        pixel_size_deg = src.transform[0]
        pixel_size_m = pixel_size_deg * 111_320
        margin_deg = pixel_size_deg * margin_px

        minx, miny, maxx, maxy = geom.bounds
        window = rasterio.windows.from_bounds(
            minx - margin_deg, miny - margin_deg, maxx + margin_deg, maxy + margin_deg,
            transform=src.transform,
        )
        dem_window = src.read(1, window=window)
        if dem_window.size == 0:
            return None, "janela vazia (geometria fora do raster)"

        window_transform = src.window_transform(window)
        gy, gx = np.gradient(dem_window.astype("float64"), pixel_size_m)
        slope_deg = np.degrees(np.arctan(np.sqrt(gx**2 + gy**2)))
        slope_norm = normalize_slope(slope_deg)

        with MemoryFile() as memfile:
            with memfile.open(
                driver="GTiff", height=slope_norm.shape[0], width=slope_norm.shape[1],
                count=1, dtype=slope_norm.dtype, crs=src.crs, transform=window_transform,
            ) as dataset:
                dataset.write(slope_norm, 1)
                try:
                    out_image, _ = mask(dataset, [geom], crop=True)
                except ValueError as e:
                    return None, f"geometria fora do raster ({e})"
                valid = out_image[out_image > 0]
                if valid.size == 0:
                    return None, "nenhum pixel valido dentro do poligono (provavelmente 100% agua/nodata)"
                return float(valid.mean()), None


def main():
    input_path, dem_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(input_path, encoding="utf-8") as f:
        features = json.load(f)

    results = []
    for feat in features:
        geom = shape(feat["geometry"])
        value, error = compute_for_geometry(dem_path, geom)
        results.append({"id": feat["id"], "name": feat["name"], "terrain_slope": value, "error": error})
        print(f"{feat['name']}: terrain_slope={value} error={error}")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
