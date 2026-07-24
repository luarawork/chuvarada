// Corrige hydro_proximity=0 em bairros COSTEIROS (is_coastal=true) usando
// distância à linha de costa como complemento à distância a rio já
// calculada por process_bho.py -- ver
// scripts/coastal_hydro_proximity.py pro motivo (BHO não classifica
// oceano/baía como curso_dagua) e docs/diagnostico_cobertura_sul_sudeste.md
// pro achado original (43 bairros em 0, 41 deles costeiros).
//
// Só mexe em bairros com is_coastal=true -- os não-costeiros com
// hydro_proximity=0 (ex: um bairro no interior genuinamente longe de
// qualquer rio mapeado) não têm linha de costa próxima que ajude, e
// aplicar esse fallback ali daria um número sem sentido.
//
// Descarta automaticamente qualquer resultado com distance_km > 20 --
// a linha de costa nacional usada (geoft_bho_linha_costa.gpkg) tem só
// ~23 trechos, simplificada demais pra capturar baías complexas (ex:
// Vitória-ES/Goiabeiras deu 549km, claramente errado pra um bairro à
// beira-mar -- fica sem correção até ter uma linha de costa mais
// detalhada ou achar o rio real que passa perto).
//
// Idempotente: só busca bairros com hydro_proximity ainda = 0.
//
// Uso: node scripts/fix_hydro_proximity_coastal.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Client } = require("pg");

const PYTHON = process.env.PYTHON_EMBED_PATH || "python";
const DISTANCE_SANITY_LIMIT_KM = 20;

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query(`
      select n.id, n.name, c.name as cidade, c.state, n.geometry
      from neighborhoods n join cities c on c.id = n.city_id
      where n.hydro_proximity = 0 and n.is_coastal = true
      order by c.state, c.name
    `);

    if (rows.length === 0) {
      console.log("Nenhum bairro costeiro com hydro_proximity=0 -- nada a fazer.");
      return;
    }
    console.log(`${rows.length} bairros costeiros a reprocessar.`);

    const inputPath = path.join(os.tmpdir(), `coastal_hydro_${Date.now()}.json`);
    const outputPath = path.join(os.tmpdir(), `coastal_hydro_result_${Date.now()}.json`);
    const input = rows.map((r) => ({
      id: r.id,
      geometry: typeof r.geometry === "string" ? JSON.parse(r.geometry) : r.geometry,
    }));
    fs.writeFileSync(inputPath, JSON.stringify(input));

    console.log("Calculando distância à linha de costa...");
    execFileSync(PYTHON, [path.join(__dirname, "coastal_hydro_proximity.py"), inputPath, outputPath], {
      stdio: "inherit",
    });

    const results = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const byId = new Map(rows.map((r) => [r.id, r]));

    let updated = 0;
    let skippedAnomaly = 0;
    for (const r of results) {
      if (r.distance_km > DISTANCE_SANITY_LIMIT_KM) {
        const info = byId.get(r.id);
        console.log(`PULADO (${r.distance_km}km, provável limitação da linha de costa simplificada): ${info.state}/${info.cidade}/${info.name}`);
        skippedAnomaly++;
        continue;
      }
      await client.query(`update neighborhoods set hydro_proximity = $1 where id = $2`, [r.hydro_proximity_costa, r.id]);
      updated++;
    }

    console.log(`\nAtualizados: ${updated}, pulados por distância implausível: ${skippedAnomaly}`);

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
