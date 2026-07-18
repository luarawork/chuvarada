// Faz upload dos GeoJSONs processados em public/geojson/neighborhoods_*.geojson
// para a tabela `neighborhoods` do Supabase, usando a conexão direta ao
// Postgres (bypassa RLS, igual scripts/run_migrations.js).
// Uso: node scripts/upload_neighborhoods.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const CITY_FILES = {
  Salvador: "neighborhoods_salvador.geojson",
  Recife: "neighborhoods_recife.geojson",
  Natal: "neighborhoods_natal.geojson",
};

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows: cities } = await client.query("select id, name from cities");
    const cityIdByName = Object.fromEntries(cities.map((c) => [c.name, c.id]));

    for (const [cityName, filename] of Object.entries(CITY_FILES)) {
      const cityId = cityIdByName[cityName];
      if (!cityId) throw new Error(`Cidade "${cityName}" não encontrada em cities`);

      const filePath = path.join(__dirname, "..", "public", "geojson", filename);
      const geojson = JSON.parse(fs.readFileSync(filePath, "utf8"));

      await client.query("delete from neighborhoods where city_id = $1", [cityId]);

      let inserted = 0;
      for (const feature of geojson.features) {
        const { name, terrain_slope, hydro_proximity, is_coastal } = feature.properties;
        await client.query(
          `insert into neighborhoods (city_id, name, geometry, terrain_slope, hydro_proximity, is_coastal)
           values ($1, $2, $3, $4, $5, $6)`,
          [cityId, name, JSON.stringify(feature.geometry), terrain_slope, hydro_proximity, is_coastal]
        );
        inserted++;
      }
      console.log(`${cityName}: ${inserted} bairros inseridos`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
