require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

async function main() {
  const db = new Pool({ connectionString: process.env.SUPABASE_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  try {
    const before = await db.query(`
      SELECT MIN(score) as min_score, MAX(score) as max_score, COUNT(*) as total
      FROM risk_scores
    `);
    console.log("Antes:", before.rows[0]);

    const sql = fs.readFileSync(
      path.join(__dirname, "../sql/042_score_scale_update.sql"),
      "utf-8"
    );

    console.log("Aplicando migração 042...");
    const start = Date.now();
    await db.query(sql);
    console.log(`Migração aplicada em ${((Date.now() - start) / 1000).toFixed(1)}s`);

    const after = await db.query(`
      SELECT MIN(score) as min_score, MAX(score) as max_score, COUNT(*) as total
      FROM risk_scores
    `);
    console.log("Depois:", after.rows[0]);

    const levelDist = await db.query(`SELECT level, COUNT(*) FROM risk_scores GROUP BY level ORDER BY level`);
    console.log("Distribuição de level:", levelDist.rows);

    const constraints = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'risk_scores'::regclass AND conname IN ('risk_scores_score_check', 'risk_scores_level_check')
    `);
    console.log("Constraints risk_scores:", constraints.rows);

    const crsConstraints = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'city_risk_summary'::regclass AND conname = 'city_risk_summary_worst_level_check'
    `);
    console.log("Constraint city_risk_summary:", crsConstraints.rows);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
