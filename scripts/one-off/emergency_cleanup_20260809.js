// Limpeza emergencial 09/08/2026 -- banco em 719MB (144% do limite gratuito
// de 500MB). Recorrência do incidente de 25/07 (192%/168%). Mesma receita:
// DELETE de risk_scores/merge_cache fora da janela de retenção + VACUUM FULL
// pra devolver o espaço ao SO (DELETE sozinho não encolhe o arquivo).
//
// Uso: node scripts/one-off/emergency_cleanup_20260809.js
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    console.log("=== Tamanho antes ===");
    const before = await client.query(`select get_db_size()`);
    console.log(JSON.stringify(before.rows[0].get_db_size, null, 2));

    console.log("\n=== Linhas elegíveis pra limpeza (risk_scores > 48h) ===");
    const eligible = await client.query(`
      SELECT COUNT(*) as linhas, MIN(calculated_at) as mais_antigo, MAX(calculated_at) as mais_recente
      FROM risk_scores WHERE calculated_at < NOW() - INTERVAL '48 hours'
    `);
    console.log(eligible.rows[0]);

    console.log("\n=== DELETE risk_scores > 48h ===");
    const delRs = await client.query(`DELETE FROM risk_scores WHERE calculated_at < NOW() - INTERVAL '48 hours'`);
    console.log("Deletadas:", delRs.rowCount);

    console.log("\n=== DELETE merge_cache distante > 1 dia ===");
    const delMcFar = await client.query(
      `DELETE FROM merge_cache WHERE is_near_neighborhood = false AND fetched_at < NOW() - INTERVAL '1 day'`
    );
    console.log("Deletadas:", delMcFar.rowCount);

    console.log("\n=== DELETE merge_cache próximo > 3 dias ===");
    const delMcNear = await client.query(
      `DELETE FROM merge_cache WHERE is_near_neighborhood = true AND fetched_at < NOW() - INTERVAL '3 days'`
    );
    console.log("Deletadas:", delMcNear.rowCount);

    console.log("\n=== VACUUM FULL risk_scores (pode demorar) ===");
    await client.query(`VACUUM FULL risk_scores`);
    console.log("OK");

    console.log("\n=== VACUUM FULL merge_cache (pode demorar) ===");
    await client.query(`VACUUM FULL merge_cache`);
    console.log("OK");

    console.log("\n=== Tamanho depois ===");
    const after = await client.query(`select get_db_size()`);
    console.log(JSON.stringify(after.rows[0].get_db_size, null, 2));

    console.log("\n=== Top 8 tabelas por tamanho (pg_tables) ===");
    const top8 = await client.query(`
      SELECT tablename, pg_size_pretty(pg_total_relation_size('public.'||tablename)) as tamanho
      FROM pg_tables WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size('public.'||tablename) DESC LIMIT 8
    `);
    console.table(top8.rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
