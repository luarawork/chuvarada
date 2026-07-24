// Importa os eventos filtrados do S2ID (dados-brutos/S2ID/s2id_filtered.json,
// gerado por scripts/process_s2id.py) para a tabela historical_events.
// Granularidade do S2ID é por município — neighborhood_id sempre fica null.
// Uso: node scripts/import_historical_events.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { Client } = require("pg");

const CITY_NAME_BY_MUNICIPIO = {
  SALVADOR: "Salvador",
  RECIFE: "Recife",
  NATAL: "Natal",
};

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const events = JSON.parse(fs.readFileSync("dados-brutos/S2ID/s2id_filtered.json", "utf8"));

    const { rows: cities } = await client.query("select id, name from cities");
    const cityIdByName = Object.fromEntries(cities.map((c) => [c.name, c.id]));

    let inserted = 0;
    for (const event of events) {
      const cityName = CITY_NAME_BY_MUNICIPIO[event.municipio.toUpperCase()];
      const cityId = cityIdByName[cityName];
      if (!cityId) {
        console.warn(`Cidade não encontrada para município "${event.municipio}", pulando.`);
        continue;
      }

      await client.query(
        `insert into historical_events (city_id, neighborhood_id, event_type, event_date, source, raw_data)
         values ($1, null, $2, $3, 's2id', $4)`,
        [cityId, event.desastre.toLowerCase(), event.event_date, JSON.stringify(event)]
      );
      inserted++;
    }

    console.log(`${inserted} eventos do S2ID inseridos em historical_events`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
