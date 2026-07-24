// Preenche neighborhoods.centroid_lat/centroid_lng (migração 019) a partir
// da geometria já armazenada, usando turf.js -- mesma biblioteca já usada
// em todo o resto do projeto pra cálculo de centroide (app/page.tsx,
// upload_state_expansion.js), em vez de instalar PostGIS só pra isso.
//
// Idempotente: só processa linhas com centroid_lat ainda nulo, então rodar
// de novo depois de uma expansão futura só backfilla o que for novo.
//
// Uso: node scripts/backfill_neighborhood_centroids.js
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const turf = require("@turf/turf");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query(
      `select id, geometry from neighborhoods where centroid_lat is null`
    );
    console.log(`${rows.length} bairros sem centroide.`);
    if (rows.length === 0) return;

    const BATCH_SIZE = 500;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      let idx = 0;

      for (const row of batch) {
        try {
          const geometry = typeof row.geometry === "string" ? JSON.parse(row.geometry) : row.geometry;
          const centroid = turf.centroid({ type: "Feature", geometry, properties: {} });
          const [lng, lat] = centroid.geometry.coordinates;
          const base = idx * 3;
          values.push(`($${base + 1}::uuid, $${base + 2}::float8, $${base + 3}::float8)`);
          params.push(row.id, lat, lng);
          idx++;
        } catch (err) {
          errors++;
          console.warn(`Falha ao calcular centroide de ${row.id}: ${err.message}`);
        }
      }

      if (values.length > 0) {
        const { rowCount } = await client.query(
          `update neighborhoods n set centroid_lat = v.lat, centroid_lng = v.lng
           from (values ${values.join(", ")}) as v(id, lat, lng)
           where n.id = v.id`,
          params
        );
        updated += rowCount;
      }
      console.log(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}...`);
    }

    console.log(`\nAtualizados: ${updated}, erros: ${errors}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
