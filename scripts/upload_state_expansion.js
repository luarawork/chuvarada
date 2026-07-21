// Expansão de cobertura: registra os municípios NOVOS dos 9 estados do
// Nordeste inteiros (além das capitais que já existem) na tabela `cities`,
// e sobe os bairros (ou distrito/setor, quando o município não tem bairro
// nomeado) de cada um pra `neighborhoods`.
//
// Município que já existe em `cities` (as 9 capitais — Salvador, Recife,
// Natal, Fortaleza, Maceió, Aracaju, João Pessoa, São Luís, Teresina — já
// processadas via o pipeline por cidade original) é IGNORADO por completo
// aqui: não mexe nos bairros dele. O dissolve deste pipeline estadual é
// ligeiramente diferente do pipeline por cidade original (aqui inclui
// setores sem NM_BAIRRO via fallback pra distrito/setor), então re-subir
// essas capitais pelo caminho novo trocaria nomes/contagem de bairro e o
// upsert-por-nome do upload_neighborhoods.js entenderia como bairros
// "removidos" — apagando o risk_scores/risk_events histórico deles.
//
// Uso: node scripts/upload_state_expansion.js
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const turf = require("@turf/turf");

const STATE_FILES = {
  ba: { geojson: "neighborhoods_state_ba.geojson", manifest: "state_ba_municipios.json" },
  pe: { geojson: "neighborhoods_state_pe.geojson", manifest: "state_pe_municipios.json" },
  rn: { geojson: "neighborhoods_state_rn.geojson", manifest: "state_rn_municipios.json" },
  al: { geojson: "neighborhoods_state_al.geojson", manifest: "state_al_municipios.json" },
  ce: { geojson: "neighborhoods_state_ce.geojson", manifest: "state_ce_municipios.json" },
  ma: { geojson: "neighborhoods_state_ma.geojson", manifest: "state_ma_municipios.json" },
  pb: { geojson: "neighborhoods_state_pb.geojson", manifest: "state_pb_municipios.json" },
  pi: { geojson: "neighborhoods_state_pi.geojson", manifest: "state_pi_municipios.json" },
  se: { geojson: "neighborhoods_state_se.geojson", manifest: "state_se_municipios.json" },
  // Expansão Sul + Sudeste (21/07/2026) -- mesmo pipeline do Nordeste,
  // adaptado pros 7 estados. Diferente do Nordeste, nenhuma capital desses
  // estados existia em `cities` antes desta expansão (confirmado por
  // query), então todos os municípios entram como novos, inclusive as
  // capitais litorâneas.
  pr: { geojson: "neighborhoods_state_pr.geojson", manifest: "state_pr_municipios.json" },
  sc: { geojson: "neighborhoods_state_sc.geojson", manifest: "state_sc_municipios.json" },
  rs: { geojson: "neighborhoods_state_rs.geojson", manifest: "state_rs_municipios.json" },
  sp: { geojson: "neighborhoods_state_sp.geojson", manifest: "state_sp_municipios.json" },
  rj: { geojson: "neighborhoods_state_rj.geojson", manifest: "state_rj_municipios.json" },
  mg: { geojson: "neighborhoods_state_mg.geojson", manifest: "state_mg_municipios.json" },
  es: { geojson: "neighborhoods_state_es.geojson", manifest: "state_es_municipios.json" },
};

// Estações de maré do CPTEC verificadas manualmente em
// http://ondas.cptec.inpe.br/~rondas/mares/index.php (dropdown "Selecione
// outro local"). O código de Ilhéus fornecido originalmente (40240) estava
// ERRADO — 40240 é "Terminal de Barra do Riacho-ES" (Espírito Santo, nada a
// ver). O código certo de Ilhéus é 40145. Porto Seguro não tem estação
// cadastrada no CPTEC — fica sem tide_code (fallback neutro, igual outras
// cidades sem estação).
const TIDE_CODE_OVERRIDES = {
  "Ilhéus": "40145", // Porto de Ilhéus-BA
  "Madre de Deus": "40118", // Porto de Madre de Deus-BA
  Candeias: "40135", // Porto de Aratu-BA (fica no território de Candeias)
  Ipojuca: "30685", // Porto de Suape-PE (fica majoritariamente em Ipojuca)
  "Areia Branca": "30407", // Porto de Areia Branca-Termisa-RN
  Guamaré: "30443", // Porto de Guamaré-RN
  Macau: "30445", // Porto de Macau-RN
  Cabedelo: "30540", // Porto de Cabedelo-PB
  "Tutóia": "30140", // Porto de Tutóia-MA
  "Luís Correia": "30225", // Porto de Luís Correia-PI
  "Barra dos Coqueiros": "30810", // Terminal Marítimo Inácio Barbosa-SE
  "São Gonçalo do Amarante": "30337", // Terminal Portuário de Pecém-CE
  // Itaqui (30110), Terminal da Alumar (30114) e Ponta da Madeira (30149)
  // também aparecem na lista do CPTEC, mas os 3 ficam dentro do território
  // de São Luís (cidade já cadastrada) — não há município novo pra atribuir.

  // Sul + Sudeste (21/07/2026) -- verificados em
  // http://ondas.cptec.inpe.br/~rondas/mares/index.php (mesma fonte usada
  // acima), cruzando cada nome de porto/terminal com o município real do
  // shapefile IBGE que o contém.
  Santos: "50225", // Porto de Santos-SP
  "Rio de Janeiro": "50140", // Porto do Rio de Janeiro-RJ
  Vitória: "40252", // Porto de Vitória-ES
  Paranaguá: "60132", // Porto de Paranaguá-PR (há também 60130/60135, códigos
  // de barra/canal do mesmo porto -- 60132 é a estação do porto em si)
  Florianópolis: "60245", // Porto de Florianópolis-SC
  "Rio Grande": "60370", // Porto do Rio Grande-RS
};

function computeDataLevel(municipio) {
  return municipio.is_coastal && municipio.used_real_bairro ? "partial" : "minimal";
}

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const overallStats = [];

  try {
    // Chave por (nome, estado) — não só nome. Vários municípios de BA/PE/RN
    // compartilham nome entre si e com as capitais já cadastradas (ex:
    // "Vera Cruz", "Santa Cruz", "Serrinha", "Ruy Barbosa" existem em BA E em
    // RN; "Parnamirim" existe em RN — a cidade litorânea perto de Natal — E
    // em PE, no sertão). Uma chave só por nome faria o Parnamirim-PE
    // (processado primeiro) bloquear o Parnamirim-RN de ser inserido.
    const { rows: existingCities } = await client.query("select id, name, state from cities");
    const cityKey = (name, state) => `${name}::${state}`;
    const cityIdByKey = Object.fromEntries(existingCities.map((c) => [cityKey(c.name, c.state), c.id]));

    for (const [stateCode, files] of Object.entries(STATE_FILES)) {
      const geojsonPath = path.join(__dirname, "..", "public", "geojson", files.geojson);
      const manifestPath = path.join(__dirname, "..", "public", "geojson", files.manifest);
      const geojson = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      const featuresByCity = new Map();
      for (const feature of geojson.features) {
        const city = feature.properties.city;
        if (!featuresByCity.has(city)) featuresByCity.set(city, []);
        featuresByCity.get(city).push(feature);
      }

      const stats = {
        state: stateCode.toUpperCase(),
        skipped_existing: [],
        new_cities: 0,
        new_neighborhoods: 0,
        fallback_name_cities: 0,
        coastal_new_cities: 0,
        tide_codes_assigned: [],
      };

      const stateUpper = stateCode.toUpperCase();
      for (const municipio of manifest) {
        const key = cityKey(municipio.name, stateUpper);
        if (cityIdByKey[key]) {
          stats.skipped_existing.push(municipio.name);
          continue;
        }

        const features = featuresByCity.get(municipio.name) ?? [];
        if (features.length === 0) continue;

        const collection = { type: "FeatureCollection", features };
        const [lng, lat] = turf.centroid(collection).geometry.coordinates;

        const dataLevel = computeDataLevel(municipio);
        const tideCode = TIDE_CODE_OVERRIDES[municipio.name] ?? null;
        if (tideCode) stats.tide_codes_assigned.push(municipio.name);

        const { rows: inserted } = await client.query(
          `insert into cities (name, state, lat, lng, tide_code, data_level, active)
           values ($1, $2, $3, $4, $5, $6, true)
           returning id`,
          [municipio.name, stateUpper, lat, lng, tideCode, dataLevel]
        );
        const cityId = inserted[0].id;
        cityIdByKey[key] = cityId;

        for (const feature of features) {
          const { name, terrain_slope, hydro_proximity, is_coastal, name_source } = feature.properties;
          await client.query(
            `insert into neighborhoods (city_id, name, geometry, terrain_slope, hydro_proximity, is_coastal, name_source)
             values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (city_id, name) do update set
               geometry = excluded.geometry,
               terrain_slope = excluded.terrain_slope,
               hydro_proximity = excluded.hydro_proximity,
               is_coastal = excluded.is_coastal,
               name_source = excluded.name_source`,
            [cityId, name, JSON.stringify(feature.geometry), terrain_slope, hydro_proximity, is_coastal, name_source ?? "bairro"]
          );
        }

        stats.new_cities++;
        stats.new_neighborhoods += features.length;
        if (!municipio.used_real_bairro) stats.fallback_name_cities++;
        if (municipio.is_coastal) stats.coastal_new_cities++;
      }

      console.log(
        `${stats.state}: ${stats.new_cities} municípios novos, ${stats.new_neighborhoods} bairros/distritos, ` +
          `${stats.fallback_name_cities} só com nome de fallback (sem NM_BAIRRO real), ` +
          `${stats.skipped_existing.length} já existentes ignorados (${stats.skipped_existing.join(", ") || "nenhum"})`
      );
      overallStats.push(stats);
    }

    const { rows: totalRows } = await client.query("select count(*)::int as total from neighborhoods");
    console.log(`\nTotal geral de bairros/distritos no banco após a expansão: ${totalRows[0].total}`);

    fs.writeFileSync(
      path.join(__dirname, "..", "public", "geojson", "state_expansion_report.json"),
      JSON.stringify(overallStats, null, 2)
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
