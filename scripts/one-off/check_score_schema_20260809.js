require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

async function main() {
  const db = new Pool({ connectionString: process.env.SUPABASE_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  try {
    const cols = await db.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'risk_scores' AND column_name IN ('score','level')
    `);
    console.log("risk_scores columns:", cols.rows);

    const constraints = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'risk_scores'::regclass
    `);
    console.log("risk_scores constraints:", constraints.rows);

    const crsConstraints = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'city_risk_summary'::regclass
    `);
    console.log("city_risk_summary constraints:", crsConstraints.rows);

    const counts = await db.query(`SELECT COUNT(*) FROM risk_scores`);
    console.log("risk_scores row count:", counts.rows[0]);

    const scoreRange = await db.query(`SELECT MIN(score), MAX(score) FROM risk_scores`);
    console.log("risk_scores score range:", scoreRange.rows[0]);

    const levelDist = await db.query(`SELECT level, COUNT(*) FROM risk_scores GROUP BY level ORDER BY level`);
    console.log("risk_scores level distribution:", levelDist.rows);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
