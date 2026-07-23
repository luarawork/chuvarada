// Exporta id,name,state de `cities` pra CSV -- input do
// process_municipalities.py --cities-csv (precisa ser reexportado sempre
// que novos municípios forem inseridos em `cities`, ex: expansão de estados).
//
// Uso: node scripts/export_cities_csv.js <caminho-de-saida.csv>
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { Client } = require("pg");

async function main() {
  const outPath = process.argv[2];
  if (!outPath) throw new Error("Uso: node scripts/export_cities_csv.js <saida.csv>");

  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const res = await client.query("select id, name, state from cities order by state, name");
  await client.end();

  const lines = ["id,name,state"];
  for (const row of res.rows) {
    const name = row.name.includes(",") ? `"${row.name}"` : row.name;
    lines.push(`${row.id},${name},${row.state}`);
  }
  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`${res.rows.length} cidades exportadas -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
