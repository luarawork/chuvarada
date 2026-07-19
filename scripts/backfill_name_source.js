// Preenche neighborhoods.name_source (migração 010) a partir dos arquivos
// neighborhoods_state_{uf}.geojson, que já carregam essa propriedade desde
// que process_state_neighborhoods.py foi escrito. Bairros que não aparecem
// em nenhum arquivo estadual vieram do pipeline por-capital
// (process_neighborhoods.py: Salvador, Recife, Natal, Fortaleza, Maceió,
// Aracaju, João Pessoa, Teresina), que só usa NM_BAIRRO real por construção
// — esses ficam 'bairro' por padrão.
//
// Idempotente: só atualiza linhas com name_source ainda nulo.
//
// Uso: node scripts/backfill_name_source.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const STATE_FILES = ["al", "ba", "ce", "ma", "pb", "pe", "pi", "rn", "se"];

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // (city_name -> (bairro_name -> name_source)) a partir dos 9 geojsons estaduais
    const lookup = new Map();
    for (const uf of STATE_FILES) {
      const filePath = path.join(__dirname, "..", "public", "geojson", `neighborhoods_state_${uf}.geojson`);
      if (!fs.existsSync(filePath)) continue;
      const geojson = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const feature of geojson.features) {
        const { city, name, name_source } = feature.properties;
        if (!name_source) continue;
        const key = `${city}::${name}`;
        lookup.set(key, name_source);
      }
    }
    console.log(`${lookup.size} pares (cidade, bairro) -> name_source carregados dos arquivos estaduais.`);

    const { rows } = await client.query(`
      select n.id, n.name, c.name as cidade
      from neighborhoods n
      join cities c on c.id = n.city_id
      where n.name_source is null
    `);
    console.log(`${rows.length} bairros sem name_source no banco.`);

    const BATCH_SIZE = 500;
    let fromStateFile = 0;
    let defaultedToBairro = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      batch.forEach((row, idx) => {
        const key = `${row.cidade}::${row.name}`;
        const source = lookup.get(key);
        if (source) fromStateFile++;
        else defaultedToBairro++;
        const base = idx * 2;
        values.push(`($${base + 1}::uuid, $${base + 2}::text)`);
        params.push(row.id, source ?? "bairro");
      });
      await client.query(
        `update neighborhoods n set name_source = v.source
         from (values ${values.join(", ")}) as v(id, source)
         where n.id = v.id`,
        params
      );
    }

    console.log(`Preenchido a partir dos arquivos estaduais: ${fromStateFile}`);
    console.log(`Preenchido como 'bairro' (default, pipeline por-capital): ${defaultedToBairro}`);

    const { rows: summary } = await client.query(
      "select name_source, count(*)::int as total from neighborhoods group by name_source order by total desc"
    );
    console.log("Distribuição final:", summary);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
