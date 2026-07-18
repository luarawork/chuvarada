// Executa os arquivos .sql de scripts/sql em ordem contra o Postgres do Supabase.
// Uso: node scripts/run_migrations.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  const connectionString = process.env.SUPABASE_CONNECTION_STRING;
  if (!connectionString) throw new Error("SUPABASE_CONNECTION_STRING não definida em .env.local");

  const dir = path.join(__dirname, "sql");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      console.log(`Executando ${file}...`);
      await client.query(sql);
      console.log(`OK: ${file}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
