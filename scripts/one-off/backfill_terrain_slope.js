// Atualiza terrain_slope dos bairros/distritos de AL, CE, MA, PB, PI e SE —
// upload_state_expansion.js já subiu esses estados com terrain_slope = 0.5
// (placeholder, porque o SRTM ainda não tinha sido baixado por causa do
// limite de taxa da API do OpenTopography). Agora que o SRTM real foi
// processado (process_srtm.py --state), este script sobe o valor real
// SEM reinserir cidade/bairro — upload_state_expansion.js pula cidades que
// já existem, então rodá-lo de novo não atualizaria nada.
//
// Uso: node scripts/backfill_terrain_slope.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const STATE_FILES = {
  al: "neighborhoods_state_al.geojson",
  ce: "neighborhoods_state_ce.geojson",
  ma: "neighborhoods_state_ma.geojson",
  pb: "neighborhoods_state_pb.geojson",
  pi: "neighborhoods_state_pi.geojson",
  se: "neighborhoods_state_se.geojson",
};

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows: cities } = await client.query("select id, name, state from cities");
    const cityIdByKey = Object.fromEntries(cities.map((c) => [`${c.name}::${c.state}`, c.id]));

    for (const [stateCode, filename] of Object.entries(STATE_FILES)) {
      const stateUpper = stateCode.toUpperCase();
      const geojsonPath = path.join(__dirname, "..", "public", "geojson", filename);
      const geojson = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));

      const rowsToUpdate = [];
      let missing = 0;
      for (const feature of geojson.features) {
        const { name, city, terrain_slope } = feature.properties;
        const cityId = cityIdByKey[`${city}::${stateUpper}`];
        if (!cityId) {
          missing++;
          continue;
        }
        rowsToUpdate.push([cityId, name, terrain_slope]);
      }

      // Atualiza em lotes com uma única query por lote (UPDATE ... FROM
      // VALUES) em vez de uma query por bairro — com milhares de bairros
      // por estado, uma query por linha era ordens de magnitude mais lento
      // (cada UPDATE é um round-trip de rede até o Supabase).
      const BATCH_SIZE = 500;
      let updated = 0;
      for (let i = 0; i < rowsToUpdate.length; i += BATCH_SIZE) {
        const batch = rowsToUpdate.slice(i, i + BATCH_SIZE);
        const values = [];
        const params = [];
        batch.forEach(([cityId, name, slope], idx) => {
          const base = idx * 3;
          values.push(`($${base + 1}::uuid, $${base + 2}::text, $${base + 3}::float8)`);
          params.push(cityId, name, slope);
        });
        const { rowCount } = await client.query(
          `update neighborhoods n set terrain_slope = v.slope
           from (values ${values.join(", ")}) as v(city_id, name, slope)
           where n.city_id = v.city_id and n.name = v.name`,
          params
        );
        updated += rowCount;
      }

      console.log(`${stateUpper}: ${updated} bairros atualizados com terrain_slope real` + (missing ? `, ${missing} sem cidade correspondente` : ""));
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
