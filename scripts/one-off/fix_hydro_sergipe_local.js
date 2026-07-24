// Recalcula hydro_proximity dos bairros de Sergipe combinando o valor já
// existente (derivado da BHO nacional) com a hidrografia local da SEMARH/SRH
// (dados-brutos/hidro/se_hidrografia_extracted/Hidrografia_Sergipe.shp,
// baixada manualmente via serhidro.semac.se.gov.br), pegando o MAIOR dos
// dois — ver scripts/process_hydro_sergipe.py pro motivo de combinar em vez
// de substituir (a base local é mais esparsa que a BHO pra riachos menores).
//
// Exporta os bairros de SE -> chama o script Python -> aplica o resultado.
// Idempotente: reprocessa do zero a cada execução, mas só grava linhas cujo
// valor combinado realmente muda o que já está no banco.
//
// Uso: node scripts/fix_hydro_sergipe_local.js
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
      "dados-brutos",
      "hidro",
      "se_hidrografia_extracted",
      "Hidrografia_Sergipe.shp"
    );
    if (!fs.existsSync(shpPath)) {
      throw new Error(`Shapefile não encontrado em ${shpPath} — extraia se_hidrografia.zip primeiro.`);
    }

    const { rows } = await client.query(`
      select n.id, n.name, n.hydro_proximity as old_hydro, c.name as cidade, n.geometry
      from neighborhoods n join cities c on c.id = n.city_id
      where c.state = 'SE'
      order by c.name, n.name
    `);

    const inputPath = path.join(os.tmpdir(), `se_bairros_${Date.now()}.geojson`);
    const outputPath = path.join(os.tmpdir(), `se_hydro_result_${Date.now()}.json`);
    const geojson = {
      type: "FeatureCollection",
      features: rows.map((r) => ({
        type: "Feature",
        properties: { id: r.id, name: r.name, cidade: r.cidade, old_hydro: r.old_hydro },
        geometry: r.geometry,
      })),
    };
    fs.writeFileSync(inputPath, JSON.stringify(geojson));

    execFileSync(PYTHON, [path.join(__dirname, "process_hydro_sergipe.py"), inputPath, outputPath], {
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
      from neighborhoods n join cities c on c.id = n.city_id where c.state='SE'
    `);
    console.log("Distribuição final SE:", dist[0]);

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
