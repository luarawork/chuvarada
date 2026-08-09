// Corrige um bug real introduzido pelo próprio script de migração em lotes
// (scripts/one-off/apply_migration_042_batched_20260809.js).
//
// O loop de conversão usava `WHERE score <= 1` como guarda de idempotência
// (distinguir linha já convertida de não-convertida). Mas a fórmula
// GREATEST(1, LEAST(10, score * 10)) pode produzir exatamente 1 (o piso)
// quando o score original está em (0, 0.1] -- e 1 ainda satisfaz
// `score <= 1`! Uma linha assim, se re-selecionada num lote POSTERIOR
// dentro da mesma execução (sem ORDER BY, ordem de varredura não é
// garantida), era convertida de novo: GREATEST(1, LEAST(10, 1*10)) = 10.
// Resultado: 36.375 linhas com score original em (0, 0.1] (risco baixo real)
// terminaram em score=10/level=critical em vez de score=1/level=normal.
//
// Verificado antes de aplicar: MAX(score) em toda a tabela, medido ANTES
// de iniciar a migração, era 0.51664 -- abaixo até do próprio limiar de
// double-conversion (0.1 correto teria virado >1 numa passada só e nunca
// seria re-selecionado). Nenhuma linha tinha score original perto de 1.0
// (exigiria toda variável do composto no máximo simultaneamente -- não
// acontece com dado real de clima). As 36.375 linhas com score=10 e
// auto_critical=false são, com certeza prática, todas vítimas do bug --
// não existe outra forma de uma linha chegar a exatamente 10 sem
// auto_critical a partir de um dataset cujo máximo histórico era 0.517.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

async function main() {
  const db = new Pool({ connectionString: process.env.SUPABASE_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  try {
    const before = await db.query(
      `SELECT COUNT(*) FROM risk_scores WHERE score = 10 AND auto_critical = false`
    );
    console.log("Linhas afetadas pelo bug (score=10, auto_critical=false):", before.rows[0]);

    const { rowCount } = await db.query(
      `UPDATE risk_scores SET score = 1, level = 'normal'
       WHERE score = 10 AND auto_critical = false`
    );
    console.log(`Corrigidas ${rowCount} linhas -- score=1, level=normal (piso correto pra score original em (0, 0.1]).`);

    const levelDist = await db.query(`SELECT level, COUNT(*) FROM risk_scores GROUP BY level ORDER BY level`);
    console.log("Distribuição de level pós-correção:", levelDist.rows);

    const consistency = await db.query(`
      SELECT COUNT(*) FROM risk_scores
      WHERE (level = 'critical' AND score < 8.0 AND auto_critical = false)
      OR (level = 'high' AND (score < 6.5 OR score >= 8.0))
      OR (level = 'moderate' AND (score < 5.0 OR score >= 6.5))
      OR (level = 'attention' AND (score < 3.0 OR score >= 5.0))
      OR (level = 'normal' AND score >= 3.0 AND auto_critical = false)
    `);
    console.log("inconsistent rows (should be 0):", consistency.rows[0]);

    const rangeCheck = await db.query(`SELECT MIN(score), MAX(score), COUNT(*) FROM risk_scores WHERE score < 1 OR score > 10`);
    console.log("linhas fora da faixa 1-10 (deve ser 0):", rangeCheck.rows[0]);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
