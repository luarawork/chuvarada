require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

async function main() {
  const db = new Pool({ connectionString: process.env.SUPABASE_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  try {
    const criticalBreakdown = await db.query(`
      SELECT auto_critical, COUNT(*), MIN(score), MAX(score), MIN(calculated_at), MAX(calculated_at)
      FROM risk_scores
      WHERE level = 'critical'
      GROUP BY auto_critical
    `);
    console.log("critical rows by auto_critical:", criticalBreakdown.rows);

    const recentVsOld = await db.query(`
      SELECT
        (calculated_at > now() - interval '1 hour') as is_recent,
        COUNT(*)
      FROM risk_scores
      WHERE level = 'critical'
      GROUP BY is_recent
    `);
    console.log("critical rows recent vs old:", recentVsOld.rows);

    const sample = await db.query(`
      SELECT id, score, level, auto_critical, auto_critical_reason, calculated_at
      FROM risk_scores
      WHERE level = 'critical'
      ORDER BY calculated_at ASC
      LIMIT 5
    `);
    console.log("oldest 5 critical rows:", sample.rows);

    const sample2 = await db.query(`
      SELECT id, score, level, auto_critical, auto_critical_reason, calculated_at
      FROM risk_scores
      WHERE level = 'critical'
      ORDER BY calculated_at DESC
      LIMIT 5
    `);
    console.log("newest 5 critical rows:", sample2.rows);

    const consistency = await db.query(`
      SELECT COUNT(*) FROM risk_scores
      WHERE (level = 'critical' AND score < 8.0 AND auto_critical = false)
      OR (level = 'high' AND (score < 6.5 OR score >= 8.0))
      OR (level = 'moderate' AND (score < 5.0 OR score >= 6.5))
      OR (level = 'attention' AND (score < 3.0 OR score >= 5.0))
      OR (level = 'normal' AND score >= 3.0 AND auto_critical = false)
    `);
    console.log("inconsistent rows (should be 0):", consistency.rows[0]);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
