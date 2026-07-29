// Recalcula hydro_proximity dos bairros da Paraíba combinando o valor já
// existente (derivado da BHO nacional) com a hidrografia local da AESA
// (dados-brutos/hidro/pb_drenagem_extracted/Drenagem_Principal.shp +
// dados-brutos/hidro/pb_rios_extracted/_rios da PARAIBA_.shp), pegando o
// MAIOR dos dois -- ver scripts/process_hydro_pb.py pro motivo de combinar
// as duas fontes AESA em vez de usar só uma.
//
// Exporta os bairros de PB -> chama o script Python -> aplica o resultado.
// Idempotente: reprocessa do zero a cada execução, mas só grava linhas cujo
// valor combinado realmente muda o que já está no banco.
//
// Uso: node scripts/one-off/fix_hydro_pb_local.js
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
    const drenagemPath = path.join(
      __dirname,
      "..",
      "..",
      "dados-brutos",
      "hidro",
      "pb_drenagem_extracted",
      "Drenagem_Principal.shp"
    );
    const riosPath = path.join(
      __dirname,
      "..",
      "..",
      "dados-brutos",
      "hidro",
      "pb_rios_extracted",
      "_rios da PARAIBA_.shp"
    );
    if (!fs.existsSync(drenagemPath) || !fs.existsSync(riosPath)) {
      throw new Error("Shapefiles da AESA/PB não encontrados -- extraia pb_drenagem_principal.zip e pb_rios.zip primeiro.");
    }

    const { rows } = await client.query(`
      select n.id, n.name, n.hydro_proximity as old_hydro, c.name as cidade, n.geometry_simplified as geometry
      from neighborhoods n join cities c on c.id = n.city_id
      where c.state = 'PB'
      order by c.name, n.name
    `);

    const inputPath = path.join(os.tmpdir(), `pb_bairros_${Date.now()}.geojson`);
    const outputPath = path.join(os.tmpdir(), `pb_hydro_result_${Date.now()}.json`);
    const geojson = {
      type: "FeatureCollection",
      features: rows.map((r) => ({
        type: "Feature",
        properties: { id: r.id, name: r.name, cidade: r.cidade, old_hydro: r.old_hydro },
        geometry: typeof r.geometry === "string" ? JSON.parse(r.geometry) : r.geometry,
      })),
    };
    fs.writeFileSync(inputPath, JSON.stringify(geojson));

    execFileSync(PYTHON, [path.join(__dirname, "..", "process_hydro_pb.py"), inputPath, outputPath], {
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
      from neighborhoods n join cities c on c.id = n.city_id where c.state='PB'
    `);
    console.log("Distribuição final PB:", dist[0]);

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
