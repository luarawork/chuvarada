// Corrige hydro_proximity=0 causado pelo NORDESTE_BBOX antigo de
// scripts/process_bho.py, que cortava os 4 lados da extensão real dos 9
// estados (ver docs/diagnostico_estados_lacunas.md, seção 2). Depois de
// alargar o bbox, reprocessa só os bairros que ainda estão em 0 nos estados
// afetados (MA, PB, PI, PE — os únicos com hydro_proximity=0 explicado por
// bbox; AL/SE/CE já estavam OK e não precisam reprocessar).
//
// Exporta os bairros afetados pra um GeoJSON temporário, chama
// process_bho.py contra ele (que recalcula hydro_proximity in-place usando
// o gpkg nacional já baixado), e aplica os valores > 0 de volta no banco.
// Idempotente: só busca bairros com hydro_proximity ainda = 0.
//
// Requer: Python com geopandas/rasterio/pyogrio (ver PYTHON_EMBED_PATH),
// dados-brutos/ana/geoft_bho_curso_dagua.gpkg já baixado (~2,9GB).
//
// Uso: node scripts/fix_hydro_proximity_bbox.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Client } = require("pg");

const PYTHON = process.env.PYTHON_EMBED_PATH || "python";
const AFFECTED_STATES = ["MA", "PB", "PI", "PE"];

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query(
      `select n.id, n.name, c.name as cidade, c.state, n.geometry
       from neighborhoods n join cities c on c.id = n.city_id
       where c.state = any($1) and n.hydro_proximity = 0
       order by c.state, c.name`,
      [AFFECTED_STATES]
    );

    if (rows.length === 0) {
      console.log("Nenhum bairro com hydro_proximity=0 em MA/PB/PI/PE — nada a fazer.");
      return;
    }
    console.log(`${rows.length} bairros a reprocessar.`);

    const inputPath = path.join(os.tmpdir(), `hydro_fix_${Date.now()}.geojson`);
    const geojson = {
      type: "FeatureCollection",
      features: rows.map((r) => ({
        type: "Feature",
        properties: { id: r.id, name: r.name, cidade: r.cidade, state: r.state },
        geometry: r.geometry,
      })),
    };
    fs.writeFileSync(inputPath, JSON.stringify(geojson));

    const gpkgPath = path.join(__dirname, "..", "dados-brutos", "ana", "geoft_bho_curso_dagua.gpkg");
    if (!fs.existsSync(gpkgPath)) {
      throw new Error(`Geopackage não encontrado em ${gpkgPath} — baixe antes de rodar este script.`);
    }

    console.log("Rodando process_bho.py com o bbox atual (pode levar alguns minutos)...");
    execFileSync(PYTHON, [path.join(__dirname, "process_bho.py"), "--input", gpkgPath, "--neighborhoods", inputPath], {
      stdio: "inherit",
    });

    const result = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const toUpdate = result.features.filter((f) => f.properties.hydro_proximity > 0);
    const stillZero = result.features.filter((f) => f.properties.hydro_proximity === 0);

    const byState = {};
    for (const f of toUpdate) {
      await client.query("update neighborhoods set hydro_proximity = $1 where id = $2", [
        f.properties.hydro_proximity,
        f.properties.id,
      ]);
      byState[f.properties.state] = (byState[f.properties.state] || 0) + 1;
    }

    console.log(`Atualizados: ${toUpdate.length}`, byState);
    if (stillZero.length > 0) {
      console.log(
        `Continuam em 0 (fora de alcance mesmo com bbox alargado, ou sem curso d'água mapeado próximo): ${stillZero.length}`
      );
      console.log(stillZero.map((f) => `${f.properties.state}/${f.properties.cidade}/${f.properties.name}`));
    }

    fs.unlinkSync(inputPath);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
