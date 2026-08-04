// Corrige o centroide de Goiabeiras/Vitória-ES: centroid_lng estava em
// -33,23 (achado durante a investigação do raio de 22km do hydro_proximity,
// docs/reports) -- ~700km a leste da posição real de Vitória (~-40,3), o
// bairro caiu no meio do Atlântico. Causa exata da corrupção não
// investigada (script de geração de centroide não guarda log por bairro
// individual); os outros 86 bairros de Vitória têm lng entre -40,24 e
// -40,36, então é um caso isolado, não um bug sistêmico de processamento.
//
// Coordenada corrigida (-20,27/-40,30): Goiabeiras é bairro da parte norte
// da ilha, próximo à UFES -- posição batida contra o cluster de bairros
// vizinhos reais (Boa Vista, Morada de Camburí, Mata da Praia, República),
// todos a menos de ~0,01° de distância da coordenada usada aqui.
//
// hydro_proximity recalculado como estimativa provisória (média dos 8
// bairros de Vitória mais próximos da coordenada corrigida, 0,897) --
// NÃO é o valor real da ordem de Strahler, porque o .gpkg da BHO
// (2,9GB) não está em disco (removido depois do reprocessamento nacional,
// ver docs/architecture/ADR-008-strahler-hydro-proximity.md). Reprocessar
// de verdade com scripts/python/process_bho_strahler.py --states ES
// quando o arquivo for baixado de novo.
//
// Idempotente: só mexe se o lng ainda estiver fora da faixa de Vitória.
//
// Uso: node scripts/one-off/fix_goiabeiras_centroid.js
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

const LAT_CORRIGIDA = -20.27;
const LNG_CORRIGIDA = -40.3;
const HYDRO_PROXIMITY_ESTIMADO = 0.897; // média dos 8 bairros mais próximos da coordenada corrigida

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows: before } = await client.query(
      `select n.id, n.name, n.centroid_lat, n.centroid_lng, n.hydro_proximity
       from neighborhoods n join cities c on c.id = n.city_id
       where n.name = 'Goiabeiras' and c.name = 'Vitória' and c.state = 'ES'`
    );
    if (before.length === 0) throw new Error("Goiabeiras/Vitória-ES não encontrada");
    console.log("Antes:", before[0]);

    if (before[0].centroid_lng > -41 && before[0].centroid_lng < -39.5) {
      console.log("centroid_lng já está na faixa correta de Vitória — nada a fazer.");
      return;
    }

    const { rows: after } = await client.query(
      `update neighborhoods
       set centroid_lat = $1, centroid_lng = $2, hydro_proximity = $3
       where id = $4
       returning id, name, centroid_lat, centroid_lng, hydro_proximity`,
      [LAT_CORRIGIDA, LNG_CORRIGIDA, HYDRO_PROXIMITY_ESTIMADO, before[0].id]
    );
    console.log("Depois:", after[0]);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
