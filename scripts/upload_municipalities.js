// Faz upload do GeoJSON processado por process_municipalities.py
// (public/geojson/municipalities.geojson, gitignored -- ver .gitignore)
// para a tabela `municipalities` do Supabase, usando conexão direta ao
// Postgres (mesmo padrão de upload_neighborhoods.js).
//
// Upsert por city_id (índice único, migração 023): rodar de novo depois
// de reprocessar o GeoJSON atualiza em vez de duplicar.
//
// Uso: node scripts/upload_municipalities.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const GEOJSON_PATH = path.join(__dirname, "..", "public", "geojson", "municipalities.geojson");
const BATCH_SIZE = 100;

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    console.log("Lendo GeoJSON...");
    const geojson = JSON.parse(fs.readFileSync(GEOJSON_PATH, "utf-8"));
    console.log(`${geojson.features.length} municípios a inserir.`);

    let upserted = 0;
    for (let i = 0; i < geojson.features.length; i += BATCH_SIZE) {
      const batch = geojson.features.slice(i, i + BATCH_SIZE);
      for (const feature of batch) {
        const { city_id, name, state, centroid_lat, centroid_lng } = feature.properties;
        await client.query(
          `insert into municipalities (city_id, name, state, geometry, geometry_simplified, centroid_lat, centroid_lng)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (city_id) do update set
             name = excluded.name,
             state = excluded.state,
             geometry = excluded.geometry,
             geometry_simplified = excluded.geometry_simplified,
             centroid_lat = excluded.centroid_lat,
             centroid_lng = excluded.centroid_lng`,
          [
            city_id,
            name,
            state,
            JSON.stringify(feature.geometry),
            JSON.stringify(feature.geometry_simplified),
            centroid_lat,
            centroid_lng,
          ]
        );
        upserted++;
      }
      console.log(`  ${Math.min(i + BATCH_SIZE, geojson.features.length)}/${geojson.features.length}...`);
    }

    console.log(`\nMunicípios inseridos/atualizados: ${upserted}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
