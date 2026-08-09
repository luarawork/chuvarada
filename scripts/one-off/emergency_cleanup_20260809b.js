// Segunda limpeza emergencial do dia (banco em 855MB às 18h26 UTC, depois
// de já ter passado por uma limpeza pela manhã -- ver
// emergency_cleanup_20260809.js). Mesma receita: DELETE risk_scores>48h +
// merge_cache fora da retenção + VACUUM FULL nas duas tabelas.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

async function main() {
  const db = new Pool({ connectionString: process.env.SUPABASE_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  try {
    const before = await db.query(
      "SELECT pg_size_pretty(pg_database_size(current_database())) as size, pg_database_size(current_database())/1024.0/1024.0 as mb"
    );
    console.log("Antes:", before.rows[0]);

    const eligibleRS = await db.query(
      `SELECT COUNT(*), MIN(calculated_at), MAX(calculated_at) FROM risk_scores WHERE calculated_at < NOW() - INTERVAL '48 hours'`
    );
    console.log("risk_scores elegíveis (>48h):", eligibleRS.rows[0]);

    const delRS = await db.query(`DELETE FROM risk_scores WHERE calculated_at < NOW() - INTERVAL '48 hours'`);
    console.log(`Deletadas ${delRS.rowCount} linhas de risk_scores.`);

    const delMergeFar = await db.query(
      `DELETE FROM merge_cache WHERE is_near_neighborhood = false AND fetched_at < NOW() - INTERVAL '1 day'`
    );
    console.log(`Deletadas ${delMergeFar.rowCount} linhas de merge_cache (distante >1d).`);

    const delMergeNear = await db.query(
      `DELETE FROM merge_cache WHERE is_near_neighborhood = true AND fetched_at < NOW() - INTERVAL '3 days'`
    );
    console.log(`Deletadas ${delMergeNear.rowCount} linhas de merge_cache (próximo >3d).`);

    console.log("Rodando VACUUM FULL risk_scores (pode demorar)...");
    await db.query("VACUUM FULL risk_scores");
    console.log("Rodando VACUUM FULL merge_cache...");
    await db.query("VACUUM FULL merge_cache");

    const after = await db.query(
      "SELECT pg_size_pretty(pg_database_size(current_database())) as size, pg_database_size(current_database())/1024.0/1024.0 as mb"
    );
    console.log("Depois:", after.rows[0]);

    const tables = await db.query(`
      SELECT tablename, pg_size_pretty(pg_total_relation_size('public.'||tablename)) as tamanho
      FROM pg_tables WHERE schemaname='public'
      ORDER BY pg_total_relation_size('public.'||tablename) DESC LIMIT 8
    `);
    console.log("Top 8 tabelas:", tables.rows);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
