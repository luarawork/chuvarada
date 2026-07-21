// Faz upload dos GeoJSONs processados em public/geojson/neighborhoods_*.geojson
// para a tabela `neighborhoods` do Supabase, usando a conexão direta ao
// Postgres (bypassa RLS, igual scripts/run_migrations.js).
//
// Upsert por (city_id, name) em vez de delete+insert: preserva o id de
// bairros que já existem, para não derrubar (via on delete cascade) o
// risk_scores/risk_events já calculado pra eles a cada rodada. Só remove
// do banco os bairros que realmente saíram do GeoJSON (ex: reprocessamento
// com limites diferentes).
//
// Uso: node scripts/upload_neighborhoods.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const turf = require("@turf/turf");

const CITY_FILES = {
  Salvador: "neighborhoods_salvador.geojson",
  Recife: "neighborhoods_recife.geojson",
  Natal: "neighborhoods_natal.geojson",
  Fortaleza: "neighborhoods_fortaleza.geojson",
  "Maceió": "neighborhoods_maceió.geojson",
  Aracaju: "neighborhoods_aracaju.geojson",
  "João Pessoa": "neighborhoods_joão_pessoa.geojson",
  Teresina: "neighborhoods_teresina.geojson",
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

      let upserted = 0;
      const namesInFile = [];
      for (const feature of geojson.features) {
        const { name, terrain_slope, hydro_proximity, is_coastal } = feature.properties;
        namesInFile.push(name);
        const centroid = turf.centroid(feature);
        const [centroidLng, centroidLat] = centroid.geometry.coordinates;
        await client.query(
          `insert into neighborhoods (city_id, name, geometry, terrain_slope, hydro_proximity, is_coastal, centroid_lat, centroid_lng)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (city_id, name) do update set
             geometry = excluded.geometry,
             terrain_slope = excluded.terrain_slope,
             hydro_proximity = excluded.hydro_proximity,
             is_coastal = excluded.is_coastal,
             centroid_lat = excluded.centroid_lat,
             centroid_lng = excluded.centroid_lng`,
          [cityId, name, JSON.stringify(feature.geometry), terrain_slope, hydro_proximity, is_coastal, centroidLat, centroidLng]
        );
        upserted++;
      }

      const { rowCount: removed } = await client.query(
        `delete from neighborhoods where city_id = $1 and not (name = any($2::text[]))`,
        [cityId, namesInFile]
      );

      console.log(
        `${cityName}: ${upserted} bairros atualizados/inseridos` +
          (removed ? `, ${removed} removidos (não estão mais no GeoJSON)` : "")
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
