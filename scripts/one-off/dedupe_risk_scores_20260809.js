// Remove duplicatas de risk_scores causadas pelo lock do Cron A com TTL
// curto demais (10min) -- duas execuções sobrepostas dobraram o score de
// todo o Brasil em 2 das últimas 24h (achado em 09/08/2026). Mantém só a
// linha mais recente por bairro/hora. Ver migração 040 (índice único que
// previne recorrência) e app/api/cron/scores/route.ts (LOCK_MAX_AGE_MINUTES
// 10 -> 20, a causa raiz).
//
// Reescrito de "DELETE ... WHERE id NOT IN (SELECT DISTINCT ON ...)" pra
// EXISTS correlacionado -- o NOT IN deu timeout (>2min) contra ~1M linhas;
// EXISTS usa o índice já existente risk_scores_neighborhood_time
// (neighborhood_id, calculated_at DESC), muito mais rápido nesse volume.
//
// Uso: node scripts/one-off/dedupe_risk_scores_20260809.js
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const before = await client.query(`
      SELECT COUNT(*) as duplicatas FROM (
        SELECT neighborhood_id, DATE_TRUNC('hour', calculated_at)
        FROM risk_scores
        WHERE calculated_at > NOW() - INTERVAL '24 hours'
        GROUP BY neighborhood_id, DATE_TRUNC('hour', calculated_at)
        HAVING COUNT(*) > 1
      ) sub
    `);
    console.log("Grupos duplicados antes:", before.rows[0].duplicatas);

    const del = await client.query(`
      DELETE FROM risk_scores rs
      WHERE rs.calculated_at > NOW() - INTERVAL '24 hours'
      AND EXISTS (
        SELECT 1 FROM risk_scores rs2
        WHERE rs2.neighborhood_id = rs.neighborhood_id
        AND DATE_TRUNC('hour', rs2.calculated_at) = DATE_TRUNC('hour', rs.calculated_at)
        AND rs2.calculated_at > rs.calculated_at
      )
    `);
    console.log("Linhas deletadas:", del.rowCount);

    const after = await client.query(`
      SELECT COUNT(*) as duplicatas FROM (
        SELECT neighborhood_id, DATE_TRUNC('hour', calculated_at)
        FROM risk_scores
        WHERE calculated_at > NOW() - INTERVAL '24 hours'
        GROUP BY neighborhood_id, DATE_TRUNC('hour', calculated_at)
        HAVING COUNT(*) > 1
      ) sub
    `);
    console.log("Grupos duplicados depois:", after.rows[0].duplicatas);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
