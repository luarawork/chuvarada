// Recalcula hydro_proximity dos bairros de Minas Gerais combinando o valor
// já existente (derivado da BHO nacional) com a hidrografia local do IGAM
// (dados-brutos/hidro/mg/extracted/ide_0104_mg_hidrografia_principal_lin.shp,
// "Principais trechos hidrográficos de Minas Gerais", baixada via WFS de
// geoserver.meioambiente.mg.gov.br em 28/07/2026), pegando o MAIOR dos dois
// -- ver scripts/python/process_hydro_mg.py pro motivo de combinar em vez
// de substituir.
//
// Exporta os bairros de MG -> chama o script Python -> aplica o resultado.
// Idempotente: reprocessa do zero a cada execução, mas só grava linhas cujo
// valor combinado realmente muda o que já está no banco.
//
// Uso: node scripts/one-off/fix_hydro_mg_local.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Client } = require("pg");

const PYTHON = process.env.PYTHON_EMBED_PATH || "python";

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const shpPath = path.join(
      __dirname,
      "..",
      "..",
      "dados-brutos",
      "hidro",
      "mg",
      "extracted",
      "ide_0104_mg_hidrografia_principal_lin.shp"
    );
    if (!fs.existsSync(shpPath)) {
      throw new Error(`Shapefile não encontrado em ${shpPath} — baixe e extraia mg_hidrografia_principal.zip primeiro.`);
    }

    const { rows } = await client.query(`
      select n.id, n.name, n.hydro_proximity as old_hydro, c.name as cidade, n.geometry_simplified as geometry
      from neighborhoods n join cities c on c.id = n.city_id
      where c.state = 'MG'
      order by c.name, n.name
    `);

    const inputPath = path.join(os.tmpdir(), `mg_bairros_${Date.now()}.geojson`);
    const outputPath = path.join(os.tmpdir(), `mg_hydro_result_${Date.now()}.json`);
    const geojson = {
      type: "FeatureCollection",
      features: rows.map((r) => ({
        type: "Feature",
        properties: { id: r.id, name: r.name, cidade: r.cidade, old_hydro: r.old_hydro },
        geometry: typeof r.geometry === "string" ? JSON.parse(r.geometry) : r.geometry,
      })),
    };
    fs.writeFileSync(inputPath, JSON.stringify(geojson));

    execFileSync(PYTHON, [path.join(__dirname, "..", "python", "process_hydro_mg.py"), inputPath, outputPath], {
      stdio: "inherit",
    });

    const results = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const toUpdate = results.filter((r) => Math.abs(r.combined - r.old_hydro) > 0.001);

    for (const r of toUpdate) {
      await client.query("update neighborhoods set hydro_proximity = $1 where id = $2", [r.combined, r.id]);
    }
    console.log(`${toUpdate.length} bairros atualizados (de ${results.length} processados).`);

    const { rows: dist } = await client.query(`
      select round(min(hydro_proximity)::numeric,3) as min, round(max(hydro_proximity)::numeric,3) as max,
             round(avg(hydro_proximity)::numeric,3) as media
      from neighborhoods n join cities c on c.id = n.city_id where c.state='MG'
    `);
    console.log("Distribuição final MG:", dist[0]);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
