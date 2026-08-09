// Aplica a migração 042 em lotes -- a versão de statement único (todo o
// arquivo scripts/sql/042_score_scale_update.sql numa query só) bateu
// "canceling statement due to statement timeout" no pooler do Supabase
// tentando fazer UPDATE em ~1.07M linhas de uma vez (mesmo padrão de
// timeout já visto nesta sessão em queries pesadas sem filtro). Postgres
// reverteu a transação implícita inteira nas duas tentativas -- nenhum
// dado ficou pela metade, confirmado consultando o banco antes de tentar
// de novo.
//
// Estratégia: DROP das constraints antigas primeiro (rápido, statement
// isolado), depois os 2 UPDATEs em lotes de BATCH_SIZE linhas (mesmo
// padrão de scripts/archive_to_b2.ts), só então as constraints novas.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const BATCH_SIZE = 20_000;

async function main() {
  const db = new Pool({ connectionString: process.env.SUPABASE_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  try {
    const before = await db.query(`SELECT MIN(score) as min, MAX(score) as max, COUNT(*) as total FROM risk_scores`);
    console.log("Antes:", before.rows[0]);

    console.log("1. Derrubando constraints antigas...");
    await db.query(`ALTER TABLE risk_scores DROP CONSTRAINT IF EXISTS risk_scores_score_check`);
    await db.query(`ALTER TABLE risk_scores DROP CONSTRAINT IF EXISTS risk_scores_level_check`);
    console.log("   ok.");

    console.log("2. Convertendo score de 0-1 pra 1-10 em lotes...");
    let totalScoreUpdated = 0;
    while (true) {
      const { rowCount } = await db.query(
        `UPDATE risk_scores
         SET score = GREATEST(1, LEAST(10, score * 10))
         WHERE id IN (SELECT id FROM risk_scores WHERE score <= 1 LIMIT $1)`,
        [BATCH_SIZE]
      );
      totalScoreUpdated += rowCount;
      if (rowCount > 0) console.log(`   ${totalScoreUpdated} linhas convertidas até agora...`);
      if (rowCount < BATCH_SIZE) break;
    }
    console.log(`   total: ${totalScoreUpdated} linhas de score convertidas.`);

    console.log("3. Recalculando level em lotes...");
    let totalLevelUpdated = 0;
    while (true) {
      const { rowCount } = await db.query(
        `UPDATE risk_scores
         SET level = CASE
           WHEN auto_critical = true THEN 'critical'
           WHEN score >= 8.0 THEN 'critical'
           WHEN score >= 6.5 THEN 'high'
           WHEN score >= 5.0 THEN 'moderate'
           WHEN score >= 3.0 THEN 'attention'
           ELSE 'normal'
         END
         WHERE id IN (
           SELECT id FROM risk_scores
           WHERE level != CASE
             WHEN auto_critical = true THEN 'critical'
             WHEN score >= 8.0 THEN 'critical'
             WHEN score >= 6.5 THEN 'high'
             WHEN score >= 5.0 THEN 'moderate'
             WHEN score >= 3.0 THEN 'attention'
             ELSE 'normal'
           END
           LIMIT $1
         )`,
        [BATCH_SIZE]
      );
      totalLevelUpdated += rowCount;
      if (rowCount > 0) console.log(`   ${totalLevelUpdated} linhas de level recalculadas até agora...`);
      if (rowCount < BATCH_SIZE) break;
    }
    console.log(`   total: ${totalLevelUpdated} linhas de level recalculadas.`);

    console.log("4. Criando constraints novas...");
    await db.query(`ALTER TABLE risk_scores ADD CONSTRAINT risk_scores_score_check CHECK (score >= 1 AND score <= 10)`);
    await db.query(
      `ALTER TABLE risk_scores ADD CONSTRAINT risk_scores_level_check CHECK (level IN ('normal', 'attention', 'moderate', 'high', 'critical'))`
    );
    console.log("   ok.");

    console.log("5. city_risk_summary.worst_level...");
    await db.query(`ALTER TABLE city_risk_summary DROP CONSTRAINT IF EXISTS city_risk_summary_worst_level_check`);
    await db.query(
      `ALTER TABLE city_risk_summary ADD CONSTRAINT city_risk_summary_worst_level_check CHECK (worst_level IN ('normal', 'attention', 'moderate', 'high', 'critical'))`
    );
    console.log("   ok.");

    const after = await db.query(`SELECT MIN(score) as min, MAX(score) as max, COUNT(*) as total FROM risk_scores`);
    console.log("Depois:", after.rows[0]);
    const levelDist = await db.query(`SELECT level, COUNT(*) FROM risk_scores GROUP BY level ORDER BY level`);
    console.log("Distribuição de level:", levelDist.rows);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
