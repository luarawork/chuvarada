// Corrige os bairros que ficaram com terrain_slope=0.5 (placeholder) porque
// caem fora do raster estadual usado no processamento original:
// - Salvador/BA (Ilha Bom Jesus dos Passos, Aeroporto): dentro do bbox de
//   dados-brutos/srtm/srtm_bahia.tif, só não foram cobertos na primeira
//   passada (provável hiccup pontual do processamento em janela).
// - Fernando de Noronha/PE: arquipélago ~350km da costa, fora do bbox de
//   srtm_pernambuco.tif — baixado um recorte à parte via OpenTopography.
// - Equador/RN (5 bairros): município no extremo sul do RN, fora do limite
//   inferior de srtm_rn.tif — baixado um recorte à parte via OpenTopography.
//
// Pré-requisito pros dois casos "à parte": rodar antes
//   scripts/download_srtm_patch.js (baixa os 2 recortes faltantes via
//   OpenTopography, requer OPENTOPOGRAPHY_API_KEY no .env.local).
//
// Idempotente: só processa bairros com terrain_slope ainda exatamente 0.5.
//
// Uso: node scripts/fix_terrain_slope_placeholders.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Client } = require("pg");

const PYTHON = process.env.PYTHON_EMBED_PATH || "python";

// Município (cidade) -> raster a usar. Fora daqui, cai no raster estadual
// padrão (srtm_{ba,pe,rn}.tif) já usado pelo processamento original.
const CITY_RASTER_OVERRIDES = {
  "Fernando de Noronha": "dados-brutos/srtm/srtm_fernando_de_noronha.tif",
  Equador: "dados-brutos/srtm/srtm_equador_rn.tif",
};

const STATE_DEFAULT_RASTER = {
  BA: "dados-brutos/srtm/srtm_bahia.tif",
  PE: "dados-brutos/srtm/srtm_pernambuco.tif",
  RN: "dados-brutos/srtm/srtm_rn.tif",
};

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query(`
      select n.id, n.name, n.geometry, n.terrain_slope as old_slope, c.name as cidade, c.state
      from neighborhoods n
      join cities c on c.id = n.city_id
      where n.terrain_slope = 0.5
      order by c.state, c.name
    `);

    if (rows.length === 0) {
      console.log("Nenhum bairro com terrain_slope=0.5 — nada a fazer.");
      return;
    }

    const byRaster = new Map();
    for (const r of rows) {
      const rasterPath = CITY_RASTER_OVERRIDES[r.cidade] ?? STATE_DEFAULT_RASTER[r.state];
      if (!rasterPath) {
        console.warn(`Sem raster mapeado para ${r.cidade}/${r.state} — pulando ${r.name}`);
        continue;
      }
      if (!byRaster.has(rasterPath)) byRaster.set(rasterPath, []);
      byRaster.get(rasterPath).push(r);
    }

    const tmpDir = os.tmpdir();
    for (const [rasterPath, neighborhoods] of byRaster.entries()) {
      if (!fs.existsSync(rasterPath)) {
        console.warn(`Raster não encontrado: ${rasterPath} — rode scripts/download_srtm_patch.js primeiro. Pulando ${neighborhoods.length} bairro(s).`);
        continue;
      }

      const inputPath = path.join(tmpDir, `slope_input_${Date.now()}.json`);
      const outputPath = path.join(tmpDir, `slope_output_${Date.now()}.json`);
      fs.writeFileSync(
        inputPath,
        JSON.stringify(neighborhoods.map((n) => ({ id: n.id, name: n.name, geometry: n.geometry })))
      );

      execFileSync(PYTHON, [path.join(__dirname, "compute_slope_for_geometries.py"), inputPath, rasterPath, outputPath], {
        stdio: "inherit",
      });

      const results = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      for (const result of results) {
        if (result.terrain_slope === null) {
          console.warn(`Sem valor calculado para ${result.name}: ${result.error}`);
          continue;
        }
        const original = neighborhoods.find((n) => n.id === result.id);
        await client.query("update neighborhoods set terrain_slope = $1 where id = $2", [
          result.terrain_slope,
          result.id,
        ]);
        console.log(`${result.name}: ${original.old_slope} -> ${result.terrain_slope}`);
      }

      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
    }

    const { rows: remaining } = await client.query(
      "select count(*)::int as c from neighborhoods where terrain_slope = 0.5"
    );
    console.log(`Bairros com placeholder 0.5 restantes: ${remaining[0].c}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
