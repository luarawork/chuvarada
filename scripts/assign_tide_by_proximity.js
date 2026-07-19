// Atribui tide_code aos municípios costeiros sem código, usando a estação
// CPTEC mais próxima como aproximação — achado do diagnóstico de lacunas: o
// catálogo do CPTEC tem só ~23 estações no Nordeste inteiro (não há "mais
// códigos escondidos" pra pesquisar), então a solução tecnicamente correta é
// aproximar pela estação geograficamente mais próxima, não deixar sem dado.
//
// Só atribui até MAX_DISTANCE_KM (80km) — municípios mais distantes que isso
// de qualquer estação ficam sem tide_code (mais honesto que forçar uma
// aproximação de baixa confiança). Considera só cidades com ao menos 1
// bairro costeiro (is_coastal=true) e tide_code ainda nulo.
//
// Idempotente: recalcula do zero a cada execução, mas só atualiza cidades que
// ainda não têm tide_code — rodar de novo não reatribui nada.
//
// Uso: node scripts/assign_tide_by_proximity.js
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const turf = require("@turf/turf");

const MAX_DISTANCE_KM = 80;

// Escopo desta rodada: só os 7 estados diagnosticados em
// scripts/diagnostico_estados_lacunas.md. BA e RN não foram analisados aqui
// e não devem ganhar atribuições por este script sem um diagnóstico próprio.
const TARGET_STATES = ["MA", "PI", "CE", "AL", "PE", "SE", "PB"];

// Os únicos pontos de referência válidos são as CIDADES que definem uma
// estação real do catálogo CPTEC (http://ondas.cptec.inpe.br/~rondas/mares/)
// — identificadas aqui por (nome, UF) explícitos, nunca por "qualquer cidade
// que tenha esse tide_code". Filtrar só pelo VALOR do código não basta: uma
// cidade que recebeu o código por aproximação (proxy) carrega o mesmo valor
// de código da estação real, então ela passaria pelo filtro igualmente e
// contaminaria o cálculo de distância pra outras cidades próximas dela —
// exatamente o bug que gerou duas rodadas de atribuições incorretas (77 no
// total, revertidas manualmente) antes desta versão.
const REAL_STATIONS = [
  { name: "Maceió", state: "AL", code: "30725" },
  { name: "Candeias", state: "BA", code: "40135" },
  { name: "Ilhéus", state: "BA", code: "40145" },
  { name: "Madre de Deus", state: "BA", code: "40118" },
  { name: "Salvador", state: "BA", code: "40140" },
  { name: "Fortaleza", state: "CE", code: "30340" },
  { name: "São Gonçalo do Amarante", state: "CE", code: "30337" },
  { name: "São Luís", state: "MA", code: "30120" },
  { name: "Tutóia", state: "MA", code: "30140" },
  { name: "Cabedelo", state: "PB", code: "30540" },
  { name: "Ipojuca", state: "PE", code: "30685" },
  { name: "Recife", state: "PE", code: "30645" },
  { name: "Fernando de Noronha", state: "PE", code: "30955" },
  { name: "Luís Correia", state: "PI", code: "30225" },
  { name: "Areia Branca", state: "RN", code: "30407" },
  { name: "Guamaré", state: "RN", code: "30443" },
  { name: "Macau", state: "RN", code: "30445" },
  { name: "Natal", state: "RN", code: "30461" },
  { name: "Aracaju", state: "SE", code: "30825" },
  { name: "Barra dos Coqueiros", state: "SE", code: "30810" },
];

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const stations = [];
    for (const station of REAL_STATIONS) {
      const { rows } = await client.query("select lat, lng from cities where name = $1 and state = $2", [
        station.name,
        station.state,
      ]);
      if (rows.length !== 1) {
        console.warn(`Aviso: ${station.name}/${station.state} não encontrada (${rows.length} linhas) — pulando estação ${station.code}.`);
        continue;
      }
      stations.push({ code: station.code, lat: rows[0].lat, lng: rows[0].lng });
    }
    console.log(`${stations.length} estações de referência carregadas (coordenadas das cidades-sede, não de códigos já atribuídos por proxy).`);

    const { rows: coastalNoCode } = await client.query(
      `select distinct c.id, c.state, c.name, c.lat, c.lng
       from cities c
       join neighborhoods n on n.city_id = c.id and n.is_coastal = true
       where c.tide_code is null and c.state = any($1)
       order by c.state, c.name`,
      [TARGET_STATES]
    );

    if (coastalNoCode.length === 0) {
      console.log("Nenhum município costeiro sem tide_code — nada a fazer.");
      return;
    }

    let assigned = 0;
    let skipped = 0;
    const byState = {};

    for (const city of coastalNoCode) {
      let nearest = null;
      let minDist = Infinity;
      for (const st of stations) {
        const d = turf.distance(turf.point([city.lng, city.lat]), turf.point([st.lng, st.lat]), {
          units: "kilometers",
        });
        if (d < minDist) {
          minDist = d;
          nearest = st;
        }
      }

      if (minDist <= MAX_DISTANCE_KM) {
        await client.query("update cities set tide_code = $1 where id = $2", [nearest.code, city.id]);
        assigned++;
        byState[city.state] = (byState[city.state] || 0) + 1;
        console.log(`${city.state}/${city.name} -> ${nearest.code} (${minDist.toFixed(0)}km)`);
      } else {
        skipped++;
      }
    }

    console.log(`\nAtribuídos: ${assigned}`, byState);
    console.log(`Deixados sem tide_code (>${MAX_DISTANCE_KM}km de qualquer estação): ${skipped}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
