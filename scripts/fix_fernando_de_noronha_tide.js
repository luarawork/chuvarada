// Fernando de Noronha (PE) é um arquipélago com estação de maré própria no
// catálogo do CPTEC ("30955 :: Ilha de Fernando de Noronha") que nunca tinha
// sido cadastrada — achado do diagnóstico de lacunas dos 7 estados.
//
// Idempotente: só atualiza se ainda estiver null.
//
// Uso: node scripts/fix_fernando_de_noronha_tide.js
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

const TIDE_CODE = "30955";

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows: before } = await client.query(
      "select id, tide_code from cities where name = 'Fernando de Noronha' and state = 'PE'"
    );
    if (before.length !== 1) throw new Error(`Esperava 1 cidade, encontrou ${before.length}`);

    if (before[0].tide_code === TIDE_CODE) {
      console.log("Fernando de Noronha já está com tide_code =", TIDE_CODE, "— nada a fazer.");
      return;
    }

    await client.query("update cities set tide_code = $1 where id = $2", [TIDE_CODE, before[0].id]);
    console.log(`Fernando de Noronha: tide_code ${before[0].tide_code ?? "null"} -> ${TIDE_CODE}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
