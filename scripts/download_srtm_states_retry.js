// Retry pros estados que o plano original (download_srtm_states.js) tratou
// como "1 chamada só" mas que na prática excedem o teto de 450.000km² da
// API (o cálculo de área original foi só uma estimativa грosseira) -- GO
// (622.731km²), MS (~549.000km² estimado), RO (~491.000km² estimado) e TO
// (~515.000km² estimado) confirmados ou previstos como grandes demais.
// Divide os 4 num grid 2x2 (~140-160.000km² por quadrante, bem dentro do
// limite) e baixa só os quadrantes que faltam.
//
// Uso: node scripts/download_srtm_states_retry.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.OPENTOPOGRAPHY_API_KEY;
const OUT_DIR = path.join(__dirname, "..", "dados-brutos", "srtm");

const STATES = {
  go: { bbox: { south: -19.5, north: -12.4, west: -53.3, east: -45.9 }, grid: 2 },
  ms: { bbox: { south: -24.1, north: -17.2, west: -57.9, east: -51.0 }, grid: 2 },
  ro: { bbox: { south: -13.7, north: -7.9, west: -66.8, east: -59.8 }, grid: 2 },
  to: { bbox: { south: -13.5, north: -5.2, west: -50.8, east: -45.7 }, grid: 2 },
};

function splitGrid(bbox, n) {
  const latStep = (bbox.north - bbox.south) / n;
  const lonStep = (bbox.east - bbox.west) / n;
  const quadrants = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      quadrants.push({
        south: bbox.south + row * latStep,
        north: bbox.south + (row + 1) * latStep,
        west: bbox.west + col * lonStep,
        east: bbox.west + (col + 1) * lonStep,
      });
    }
  }
  return quadrants;
}

async function downloadPatch(name, bbox) {
  const url =
    `https://portal.opentopography.org/API/globaldem?demtype=SRTMGL1` +
    `&south=${bbox.south}&north=${bbox.north}&west=${bbox.west}&east=${bbox.east}` +
    `&outputFormat=GTiff&API_Key=${API_KEY}`;
  const res = await fetch(url);
  if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (/quota|limit|too many/i.test(text)) throw new Error("QUOTA_EXCEEDED");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const outPath = path.join(OUT_DIR, `${name}.tif`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  return buffer.length;
}

async function main() {
  if (!API_KEY) throw new Error("OPENTOPOGRAPHY_API_KEY não configurada");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Remove o arquivo antigo de 1-chamada-só (nunca existiu de fato, a
  // chamada falhou -- mas por segurança, garante que não fique um .tif
  // órfão de uma tentativa anterior).
  for (const uf of Object.keys(STATES)) {
    const oldPath = path.join(OUT_DIR, `srtm_${uf}.tif`);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  const done = [];
  const failed = [];
  let quotaExceeded = false;

  for (const [uf, cfg] of Object.entries(STATES)) {
    const quadrants = splitGrid(cfg.bbox, cfg.grid);
    for (let i = 0; i < quadrants.length; i++) {
      const name = `srtm_${uf}_q${i}`;
      if (quotaExceeded) {
        failed.push({ name, uf, reason: "não tentado (cota já esgotada)" });
        continue;
      }
      try {
        const bytes = await downloadPatch(name, quadrants[i]);
        console.log(`OK  ${name}: ${(bytes / 1024 / 1024).toFixed(1)}MB`);
        done.push(name);
      } catch (err) {
        if (err.message === "QUOTA_EXCEEDED") {
          console.log(`COTA ESGOTADA em ${name} -- parando.`);
          quotaExceeded = true;
          failed.push({ name, uf, reason: "cota esgotada" });
        } else {
          console.log(`ERRO ${name}: ${err.message}`);
          failed.push({ name, uf, reason: err.message });
        }
      }
    }
  }

  console.log(`\n=== Resumo retry ===`);
  console.log(`Baixados: ${done.length}`);
  console.log(`Falhas: ${JSON.stringify(failed, null, 2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
