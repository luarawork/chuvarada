// Importa os eventos de precipitação extrema identificados pelo INMET
// (docs/inmet_extreme_events.json, gerado por process_inmet_extremes.py)
// pra historical_events. Nível de CIDADE, não de bairro — o INMET só tem
// uma estação automática por cidade, sem granularidade de bairro.
//
// Uso: node scripts/import_inmet_events.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const eventsPath = path.join(__dirname, "inmet_extreme_events.json");
    const events = JSON.parse(fs.readFileSync(eventsPath, "utf8"));

    const { rows: cities } = await client.query(
      "select id, name from cities where name in ('Salvador', 'Recife', 'Natal')"
    );
    const cityIdByName = Object.fromEntries(cities.map((c) => [c.name, c.id]));

    let inserted = 0;
    const byCity = {};

    for (const event of events) {
      const cityId = cityIdByName[event.city_name];
      if (!cityId) continue;

      await client.query(
        `insert into historical_events (city_id, neighborhood_id, event_type, event_date, source, raw_data)
         values ($1, null, 'precipitacao_extrema', $2, 'inmet', $3)`,
        [cityId, event.date, JSON.stringify({ precipitation_mm: event.precipitation_mm, station: "automatica" })]
      );
      inserted++;
      byCity[event.city_name] = (byCity[event.city_name] ?? 0) + 1;
    }

    console.log(`${inserted} eventos importados:`, byCity);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
