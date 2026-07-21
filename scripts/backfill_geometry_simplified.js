// Preenche neighborhoods.geometry_simplified (migração 021) a partir da
// geometria original, usando turf.simplify (Douglas-Peucker) -- mesma
// biblioteca já usada no resto do projeto pra geometria (turf.centroid em
// app/page.tsx, upload_state_expansion.js), em vez de instalar PostGIS só
// pra isso (ST_SimplifyPreserveTopology exigiria a extensão, que o projeto
// não usa -- ver diagnóstico de performance do /api/neighborhoods).
//
// Tolerância testada empiricamente numa amostra de 30 bairros de São Paulo
// antes de escolher o valor: 0.0001° (~10m, valor inicialmente cogitado)
// não reduz quase nada (-0.0% bytes) porque os vértices da fonte IBGE já
// são mais espaçados que isso. 0.001° (~100m) dá -35% de bytes/pontos,
// equilíbrio razoável entre payload menor e forma ainda reconhecível pro
// tamanho típico de um bairro (tipicamente 1-3km de extensão). Não afeta
// terrain_slope/hydro_proximity/centroid (calculados uma vez a partir da
// geometria original, já armazenados, nunca recalculados a partir da
// versão simplificada).
//
// Idempotente: só processa linhas com geometry_simplified ainda nulo.
//
// Uso: node scripts/backfill_geometry_simplified.js
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const turf = require("@turf/turf");

const SIMPLIFY_TOLERANCE = 0.001;

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query(
      `select id, geometry from neighborhoods where geometry_simplified is null`
    );
    console.log(`${rows.length} bairros sem geometria simplificada.`);
    if (rows.length === 0) return;

    const BATCH_SIZE = 200;
    let updated = 0;
    let errors = 0;
    let originalBytes = 0;
    let simplifiedBytes = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      let idx = 0;

      for (const row of batch) {
        try {
          const geometry = typeof row.geometry === "string" ? JSON.parse(row.geometry) : row.geometry;
          const feature = { type: "Feature", geometry, properties: {} };
          const simplified = turf.simplify(feature, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false });
          const simplifiedJson = JSON.stringify(simplified.geometry);

          originalBytes += JSON.stringify(geometry).length;
          simplifiedBytes += simplifiedJson.length;

          const base = idx * 2;
          values.push(`($${base + 1}::uuid, $${base + 2}::jsonb)`);
          params.push(row.id, simplifiedJson);
          idx++;
        } catch (err) {
          errors++;
          console.warn(`Falha ao simplificar geometria de ${row.id}: ${err.message}`);
        }
      }

      if (values.length > 0) {
        const { rowCount } = await client.query(
          `update neighborhoods n set geometry_simplified = v.geom
           from (values ${values.join(", ")}) as v(id, geom)
           where n.id = v.id`,
          params
        );
        updated += rowCount;
      }
      console.log(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}...`);
    }

    const reduction = originalBytes > 0 ? (100 * (1 - simplifiedBytes / originalBytes)).toFixed(1) : "0";
    console.log(`\nAtualizados: ${updated}, erros: ${errors}`);
    console.log(`Tamanho original: ${(originalBytes / 1024 / 1024).toFixed(2)}MB, simplificado: ${(simplifiedBytes / 1024 / 1024).toFixed(2)}MB (-${reduction}%)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
