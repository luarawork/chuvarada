// Baixa SRTM (OpenTopography, SRTMGL1) pros 11 estados da expansão
// Centro-Oeste + Norte. Estados grandes (área > ~400.000km², perto do teto
// de 450.000km² da API) são divididos em quadrantes NxN e cada quadrante
// baixado separadamente -- mesclagem com rasterio fica pro
// process_srtm_states.py (não é feita aqui, só download bruto).
//
// Cota da API: 50 chamadas/dia. Se uma chamada falhar por cota esgotada
// (HTTP 429 ou mensagem de erro característica), o script PARA de tentar
// novas chamadas mas não derruba o processo -- imprime um resumo do que
// foi baixado e do que ainda falta, pra retomar no dia seguinte.
//
// Uso: node scripts/download_srtm_states.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.OPENTOPOGRAPHY_API_KEY;
const OUT_DIR = path.join(__dirname, "..", "dados-brutos", "srtm");

// bbox: south, north, west, east (graus). grid: divisão NxN (null = 1x1).
const STATES = {
  go: { bbox: { south: -19.5, north: -12.4, west: -53.3, east: -45.9 }, grid: null },
  mt: { bbox: { south: -18.1, north: -7.3, west: -61.0, east: -50.2 }, grid: 2 },
  ms: { bbox: { south: -24.1, north: -17.2, west: -57.9, east: -51.0 }, grid: null },
  df: { bbox: { south: -16.1, north: -15.4, west: -48.3, east: -47.3 }, grid: null },
  am: { bbox: { south: -9.8, north: 2.2, west: -73.8, east: -56.1 }, grid: 3 },
  pa: { bbox: { south: -10.0, north: 2.6, west: -58.5, east: -46.0 }, grid: 3 },
  rr: { bbox: { south: 1.2, north: 5.3, west: -64.9, east: -58.9 }, grid: null },
  ap: { bbox: { south: -1.2, north: 4.5, west: -52.0, east: -49.5 }, grid: null },
  ac: { bbox: { south: -11.2, north: -7.1, west: -73.8, east: -66.6 }, grid: null },
  ro: { bbox: { south: -13.7, north: -7.9, west: -66.8, east: -59.8 }, grid: null },
  to: { bbox: { south: -13.5, north: -5.2, west: -50.8, east: -45.7 }, grid: null },
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
  if (res.status === 429) {
    throw new Error("QUOTA_EXCEEDED");
  }
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
  if (!API_KEY) throw new Error("OPENTOPOGRAPHY_API_KEY não configurada em .env.local");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const jobs = [];
  for (const [uf, cfg] of Object.entries(STATES)) {
    if (cfg.grid) {
      const quadrants = splitGrid(cfg.bbox, cfg.grid);
      quadrants.forEach((q, i) => jobs.push({ name: `srtm_${uf}_q${i}`, uf, bbox: q }));
    } else {
      jobs.push({ name: `srtm_${uf}`, uf, bbox: cfg.bbox });
    }
  }

  console.log(`${jobs.length} chamadas planejadas pra ${Object.keys(STATES).length} estados.\n`);

  const done = [];
  const failed = [];
  let quotaExceeded = false;

  for (const job of jobs) {
    if (quotaExceeded) {
      failed.push({ ...job, reason: "não tentado (cota já esgotada)" });
      continue;
    }
    try {
      const bytes = await downloadPatch(job.name, job.bbox);
      console.log(`OK  ${job.name}: ${(bytes / 1024 / 1024).toFixed(1)}MB`);
      done.push(job.name);
    } catch (err) {
      if (err.message === "QUOTA_EXCEEDED") {
        console.log(`COTA ESGOTADA em ${job.name} -- parando novas chamadas.`);
        quotaExceeded = true;
        failed.push({ ...job, reason: "cota esgotada" });
      } else {
        console.log(`ERRO ${job.name}: ${err.message}`);
        failed.push({ ...job, reason: err.message });
      }
    }
  }

  const ufsWithFailure = [...new Set(failed.map((f) => f.uf))];
  const ufsFullyDone = Object.keys(STATES).filter((uf) => !ufsWithFailure.includes(uf));

  console.log(`\n=== Resumo ===`);
  console.log(`Baixados: ${done.length}/${jobs.length}`);
  console.log(`Estados completos: ${ufsFullyDone.join(", ") || "nenhum"}`);
  console.log(`Estados com pendência: ${ufsWithFailure.join(", ") || "nenhum"}`);

  fs.writeFileSync(
    path.join(OUT_DIR, "_srtm_download_status.json"),
    JSON.stringify({ done, failed, ufsFullyDone, ufsWithFailure }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
