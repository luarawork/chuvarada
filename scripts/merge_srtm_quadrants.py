"""
merge_srtm_quadrants.py

Mescla os quadrantes SRTM baixados por download_srtm_states.py /
download_srtm_states_retry.js (arquivos srtm_{uf}_q{n}.tif) num único
GeoTIFF por estado, pronto pra alimentar process_srtm.py --state.

Uso:
  python scripts/merge_srtm_quadrants.py --uf mt --quadrants 4
  python scripts/merge_srtm_quadrants.py --uf am --quadrants 9
"""
import argparse
import glob
import os

import rasterio
from rasterio.merge import merge

SRTM_DIR = "dados-brutos/srtm"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--uf", required=True)
    args = parser.parse_args()

    pattern = os.path.join(SRTM_DIR, f"srtm_{args.uf}_q*.tif")
    files = sorted(glob.glob(pattern))
    if not files:
        raise SystemExit(f"Nenhum quadrante encontrado em {pattern}")

    print(f"{len(files)} quadrantes encontrados pra {args.uf}: {[os.path.basename(f) for f in files]}")

    srcs = [rasterio.open(f) for f in files]
    mosaic, out_transform = merge(srcs)

    out_meta = srcs[0].meta.copy()
    out_meta.update(
        {
            "driver": "GTiff",
            "height": mosaic.shape[1],
            "width": mosaic.shape[2],
            "transform": out_transform,
        }
    )

    out_path = os.path.join(SRTM_DIR, f"srtm_{args.uf}.tif")
    with rasterio.open(out_path, "w", **out_meta) as dest:
        dest.write(mosaic)

    for s in srcs:
        s.close()

    print(f"Mesclado -> {out_path} ({mosaic.shape[1]}x{mosaic.shape[2]} px)")


if __name__ == "__main__":
    main()
