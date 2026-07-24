// Corrige o bug do diagnóstico de cobertura: São Luís (MA) já tinha o bairro
// dela processado em public/geojson/neighborhoods_state_ma.geojson (com
// terrain_slope/hydro_proximity reais), mas upload_state_expansion.js pulou
// a inserção porque a cidade já existia em `cities` de uma etapa anterior que
// nunca completou — sem checar se essa linha tinha bairro associado.
//
// Idempotente: não insere de novo se São Luís já tiver algum bairro.
//
// Uso: node scripts/fix_sao_luis_neighborhood.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows: cityRows } = await client.query(
      "select id from cities where state = 'MA' and name = 'São Luís'"
    );
    if (cityRows.length !== 1) {
      throw new Error(`Esperava 1 cidade "São Luís/MA", encontrou ${cityRows.length}`);
    }
    const cityId = cityRows[0].id;

    const { rows: existing } = await client.query(
      "select count(*)::int as c from neighborhoods where city_id = $1",
      [cityId]
    );
    if (existing[0].c > 0) {
      console.log(`São Luís já tem ${existing[0].c} bairro(s) — nada a fazer.`);
      return;
    }

    const geojsonPath = path.join(__dirname, "..", "public", "geojson", "neighborhoods_state_ma.geojson");
    const geojson = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
    const features = geojson.features.filter((f) => f.properties.city === "São Luís");

    if (features.length === 0) {
      throw new Error("Nenhuma feature 'São Luís' encontrada em neighborhoods_state_ma.geojson");
    }

    for (const feature of features) {
      const { name, terrain_slope, hydro_proximity, is_coastal } = feature.properties;
      const { rows: inserted } = await client.query(
        `insert into neighborhoods (city_id, name, geometry, terrain_slope, hydro_proximity, is_coastal)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [cityId, name, JSON.stringify(feature.geometry), terrain_slope, hydro_proximity, is_coastal]
      );
      console.log(`Inserido: ${name} -> id=${inserted[0].id} (slope=${terrain_slope}, hydro=${hydro_proximity}, coastal=${is_coastal})`);
    }

    console.log(`${features.length} bairro(s) inserido(s) para São Luís. Rode o cron (/api/cron/update) para calcular o score.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
