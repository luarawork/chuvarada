// Remove os 2 relatos de teste criados durante o desenvolvimento (bairro
// Graças, Recife/PE, 2026-07-24 ~13h53-13h55) que estavam poluindo as
// métricas de /analise (Total de relatos, Taxa média de confirmação).
//
// Uso: node scripts/one-off/delete_test_user_reports.js
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows: before } = await client.query("select count(*) from user_reports");
    console.log("Antes:", before[0].count, "relatos");

    const result = await client.query(`
      DELETE FROM user_reports
      WHERE neighborhood_id IN (
        SELECT n.id FROM neighborhoods n
        JOIN cities c ON c.id = n.city_id
        WHERE n.name = 'Graças' AND c.name = 'Recife'
      )
      AND created_at BETWEEN '2026-07-24 13:53:00' AND '2026-07-24 13:55:00'
    `);
    console.log("Deletados:", result.rowCount);

    const { rows: after } = await client.query("select count(*) from user_reports");
    console.log("Depois:", after[0].count, "relatos");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
