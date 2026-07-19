// Baixa os 2 recortes SRTM que faltavam pro diagnóstico de cobertura:
// Fernando de Noronha (PE) e o município de Equador (RN) ficam fora dos
// bounding boxes dos rasters estaduais já baixados (srtm_pernambuco.tif e
// srtm_rn.tif), então seus bairros nunca tiveram terrain_slope calculado de
// verdade (ficaram no placeholder 0.5).
//
// Requer OPENTOPOGRAPHY_API_KEY no .env.local (grátis em opentopography.org).
//
// Uso: node scripts/download_srtm_patch.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.OPENTOPOGRAPHY_API_KEY;
const OUT_DIR = path.join(__dirname, "..", "dados-brutos", "srtm");

// Bboxes com margem (não é só o bbox exato dos bairros — margem evita cortar
// o gradiente de declividade na borda, mesmo esquema de process_srtm.py).
const PATCHES = {
  srtm_fernando_de_noronha: { south: -3.95, north: -3.75, west: -32.55, east: -32.3 },
  srtm_equador_rn: { south: -7.05, north: -6.85, west: -36.83, east: -36.6 },
};

async function downloadPatch(name, bbox) {
  if (!API_KEY) throw new Error("OPENTOPOGRAPHY_API_KEY não configurada em .env.local");

  const url =
    `https://portal.opentopography.org/API/globaldem?demtype=SRTMGL1` +
    `&south=${bbox.south}&north=${bbox.north}&west=${bbox.west}&east=${bbox.east}` +
    `&outputFormat=GTiff&API_Key=${API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);

  const outPath = path.join(OUT_DIR, `${name}.tif`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  console.log(`${name}: ${buffer.length} bytes -> ${outPath}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, bbox] of Object.entries(PATCHES)) {
    await downloadPatch(name, bbox);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
