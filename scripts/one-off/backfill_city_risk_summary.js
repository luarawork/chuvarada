// Popula city_risk_summary (migração 022) pra todas as cidades ativas de
// uma vez, a partir dos dados já existentes em risk_scores -- necessário
// só na primeira vez após a migração, já que dali em diante o próprio cron
// mantém a tabela atualizada incrementalmente (ver upsertCityRiskSummary em
// app/api/cron/update/route.ts).
//
// Faz o "distinct on" (score mais recente por bairro) UMA vez só, num
// único SELECT direto sobre risk_scores -- não é o mesmo problema medido
// no endpoint /api/neighborhoods (join repetido a cada request); aqui é
// uma operação de agregação única, custo aceitável mesmo sobre a tabela
// inteira.
//
// Uso: node scripts/backfill_city_risk_summary.js
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    console.log("Buscando cidades ativas...");
    const { rows: cities } = await client.query(
      `select id, name, state, lat, lng, data_level from cities where active = true`
    );

    console.log("Buscando bairros (id, city_id)...");
    const { rows: neighborhoods } = await client.query(`select id, city_id from neighborhoods`);
    const cityIdByNeighborhoodId = new Map(neighborhoods.map((n) => [n.id, n.city_id]));

    console.log("Buscando score mais recente de cada bairro (distinct on, passe único)...");
    const { rows: latest } = await client.query(
      `select distinct on (neighborhood_id) neighborhood_id, score, level, calculated_at
       from risk_scores
       order by neighborhood_id, calculated_at desc`
    );
    console.log(`${latest.length} bairros com score.`);

    const byCity = new Map();
    for (const row of latest) {
      const cityId = cityIdByNeighborhoodId.get(row.neighborhood_id);
      if (!cityId) continue;
      if (!byCity.has(cityId)) byCity.set(cityId, []);
      byCity.get(cityId).push(row);
    }

    const BATCH_SIZE = 200;
    let updated = 0;
    let skipped = 0;
    const citiesWithData = cities.filter((c) => byCity.has(c.id));
    skipped = cities.length - citiesWithData.length;

    for (let i = 0; i < citiesWithData.length; i += BATCH_SIZE) {
      const batch = citiesWithData.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      let idx = 0;

      for (const city of batch) {
        const rows = byCity.get(city.id);
        const maxScore = Math.max(...rows.map((r) => r.score));
        const hasCritical = rows.some((r) => r.level === "critical");
        const hasAttention = rows.some((r) => r.level === "attention");
        const worstLevel = hasCritical ? "critical" : hasAttention ? "attention" : "normal";
        const criticalCount = rows.filter((r) => r.level === "critical").length;
        const attentionCount = rows.filter((r) => r.level === "attention").length;
        const lastUpdated = rows.reduce((max, r) => (r.calculated_at > max ? r.calculated_at : max), rows[0].calculated_at);

        const base = idx * 10;
        values.push(
          `($${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4}::float8, $${base + 5}::float8, $${base + 6}, $${base + 7}::float8, $${base + 8}, $${base + 9}::int, $${base + 10}::int)`
        );
        params.push(
          city.id,
          city.name,
          city.state,
          city.lat,
          city.lng,
          city.data_level,
          maxScore,
          worstLevel,
          criticalCount,
          attentionCount
        );
        idx++;
      }

      if (values.length > 0) {
        const { rowCount } = await client.query(
          `insert into city_risk_summary (city_id, name, state, lat, lng, data_level, max_score, worst_level, critical_count, attention_count, last_updated, refreshed_at)
           select v.city_id, v.name, v.state, v.lat, v.lng, v.data_level, v.max_score, v.worst_level, v.critical_count, v.attention_count, now(), now()
           from (values ${values.join(", ")}) as v(city_id, name, state, lat, lng, data_level, max_score, worst_level, critical_count, attention_count)
           on conflict (city_id) do update set
             name = excluded.name, state = excluded.state, lat = excluded.lat, lng = excluded.lng,
             data_level = excluded.data_level, max_score = excluded.max_score, worst_level = excluded.worst_level,
             critical_count = excluded.critical_count, attention_count = excluded.attention_count,
             last_updated = excluded.last_updated, refreshed_at = excluded.refreshed_at`,
          params
        );
        updated += rowCount;
      }
      console.log(`  ${Math.min(i + BATCH_SIZE, citiesWithData.length)}/${citiesWithData.length}...`);
    }

    console.log(`\nAtualizadas: ${updated}, sem bairro/score ainda (não inseridas): ${skipped}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
