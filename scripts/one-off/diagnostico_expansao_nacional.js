// Diagnóstico de qualidade pós-expansão CO+Norte (22/07/2026) -- roda as
// queries pedidas pra terrain_slope placeholder, hydro_proximity zero e
// name_source nulo por estado novo, além do total nacional.
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

const NEW_STATES = ["GO", "MT", "MS", "DF", "AM", "PA", "RR", "AP", "AC", "RO", "TO"];

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log("=== Totais por estado novo (municípios, bairros, bairros_reais, distritos) ===");
  const totals = await client.query(
    `select c.state,
            count(distinct c.id) as municipios,
            count(n.id) as bairros,
            count(n.id) filter (where n.name_source = 'bairro') as bairros_reais,
            count(n.id) filter (where n.name_source in ('subdistrito', 'distrito')) as distritos
     from cities c
     left join neighborhoods n on n.city_id = c.id
     where c.state = any($1)
     group by c.state
     order by c.state`,
    [NEW_STATES]
  );
  console.table(totals.rows);

  console.log("\n=== Total geral do Brasil ===");
  const national = await client.query(
    `select
       (select count(*) from cities) as municipios,
       (select count(*) from neighborhoods) as bairros,
       (select count(*) from cities where tide_code is not null) as cidades_com_mare`
  );
  console.table(national.rows);

  console.log("\n=== terrain_slope placeholder (0.5) por estado novo ===");
  const slope = await client.query(
    `select c.state,
            count(n.id) as total_bairros,
            count(n.id) filter (where n.terrain_slope = 0.5) as slope_placeholder
     from cities c
     join neighborhoods n on n.city_id = c.id
     where c.state = any($1)
     group by c.state
     order by c.state`,
    [NEW_STATES]
  );
  console.table(slope.rows);

  console.log("\n=== hydro_proximity zero por estado novo ===");
  const hydro = await client.query(
    `select c.state,
            count(n.id) as total_bairros,
            count(n.id) filter (where n.hydro_proximity = 0) as hidro_zero
     from cities c
     join neighborhoods n on n.city_id = c.id
     where c.state = any($1)
     group by c.state
     order by c.state`,
    [NEW_STATES]
  );
  console.table(hydro.rows);

  console.log("\n=== name_source nulo por estado novo ===");
  const nameSource = await client.query(
    `select c.state,
            count(n.id) as total_bairros,
            count(n.id) filter (where n.name_source is null) as sem_name_source
     from cities c
     join neighborhoods n on n.city_id = c.id
     where c.state = any($1)
     group by c.state
     order by c.state`,
    [NEW_STATES]
  );
  console.table(nameSource.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
