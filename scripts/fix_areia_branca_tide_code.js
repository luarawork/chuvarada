// Corrige o bug do diagnóstico de cobertura: TIDE_CODE_OVERRIDES em
// upload_state_expansion.js é indexado só pelo nome do município (sem UF),
// então "Areia Branca" (RN, costeira, código 30407 correto) e "Areia Branca"
// (SE, interior, is_coastal=false) acabaram com o mesmo tide_code.
//
// Idempotente: só mexe na linha de SE, e só se ainda tiver o código herdado.
//
// Uso: node scripts/fix_areia_branca_tide_code.js
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows: before } = await client.query(
      "select id, name, state, tide_code from cities where name = 'Areia Branca' order by state"
    );
    console.log("Antes:", before);

    const seCity = before.find((r) => r.state === "SE");
    if (!seCity) throw new Error("Areia Branca/SE não encontrada");

    if (seCity.tide_code === null) {
      console.log("Areia Branca/SE já está com tide_code=null — nada a fazer.");
      return;
    }

    const { rows: cacheRows } = await client.query(
      "select id from tide_cache where city_id = $1",
      [seCity.id]
    );

    await client.query(
      "update cities set tide_code = null where name = 'Areia Branca' and state = 'SE'"
    );

    if (cacheRows.length > 0) {
      const { rowCount } = await client.query("delete from tide_cache where city_id = $1", [seCity.id]);
      console.log(`${rowCount} linha(s) de tide_cache órfã(s) removida(s).`);
    }

    const { rows: after } = await client.query(
      "select id, name, state, tide_code from cities where name = 'Areia Branca' order by state"
    );
    console.log("Depois:", after);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
