import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import {
  saveToB2,
  readFromB2,
  listB2Files,
  deleteFromB2,
  getRiskScoresKey,
  getSnapshotKey,
  getMergeCacheKey,
  getWeatherCacheKey,
  getCronStatsKey,
} from "../lib/b2";

// Arquivamento diário pra Backblaze B2 (23/07/2026) -- move risk_scores mais
// antigos que ARCHIVE_CUTOFF_HOURS do Supabase pro B2 (comprimido, particionado
// por data/estado) e depois apaga do Supabase, liberando espaço.
//
// ATENÇÃO -- interação com a migração 004_retention.sql: aquela migração já
// faz downsampling de risk_scores via pg_cron dentro do próprio Supabase
// (granularidade plena só nas últimas 24h; 1 registro/hora até 14 dias; 1/dia
// depois disso), rodando toda noite às 03:00 UTC. Com o corte de 48h deste
// script, qualquer risk_scores entre 24h-48h de idade já pode ter sido
// reduzido a 1 registro/hora pela migração 004 ANTES deste script rodar --
// ou seja, o que é arquivado aqui não é necessariamente granularidade plena,
// e sim o que a 004 já deixou passar. Isso não quebra nada (o script arquiva
// o que encontrar), mas os 2 mecanismos fazem trabalho sobreposto -- avaliar
// se a 004 deve ser desativada agora que o histórico completo vai pro B2.
const ARCHIVE_CUTOFF_HOURS = 24 * 2;

const STATES = [
  "AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE",
  "PR", "SC", "RS", "SP", "RJ", "MG", "ES",
  "GO", "MT", "MS", "DF", "AM", "PA", "RR", "AP", "AC", "RO", "TO",
];

interface RiskScoreRow {
  id: string;
  score: number;
  level: string;
  rain_1h: number;
  rain_72h: number;
  rain_peak_3h: number;
  tide_level: number;
  auto_critical: boolean;
  auto_critical_reason: string | null;
  rain_source: string;
  calculated_at: string;
  neighborhood_id: string;
  neighborhood_name: string;
  name_source: string | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  city_name: string;
  state: string;
}

function getDb(): Pool {
  const connectionString = process.env.SUPABASE_CONNECTION_STRING;
  if (!connectionString) throw new Error("SUPABASE_CONNECTION_STRING não definida");
  return new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
}

async function archiveRiskScores(db: Pool): Promise<void> {
  for (const state of STATES) {
    const { rows } = await db.query<RiskScoreRow>(
      `select rs.id, rs.score, rs.level, rs.rain_1h, rs.rain_72h, rs.rain_peak_3h,
              rs.tide_level, rs.auto_critical, rs.auto_critical_reason, rs.rain_source,
              rs.calculated_at, rs.neighborhood_id,
              n.name as neighborhood_name, n.name_source, n.centroid_lat, n.centroid_lng,
              c.name as city_name, c.state
       from risk_scores rs
       join neighborhoods n on n.id = rs.neighborhood_id
       join cities c on c.id = n.city_id
       where rs.calculated_at < now() - interval '${ARCHIVE_CUTOFF_HOURS} hours'
         and c.state = $1
       limit 10000`,
      [state]
    );

    if (rows.length === 0) continue;

    const byDate = new Map<string, RiskScoreRow[]>();
    for (const row of rows) {
      // pg devolve calculated_at (timestamptz) já convertido pra Date, não
      // string -- new Date(...) aqui é só normalização defensiva caso
      // algum dia venha como string (ex: troca de driver).
      const date = new Date(row.calculated_at).toISOString().slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(row);
    }

    for (const [date, scores] of Array.from(byDate)) {
      await saveToB2(getRiskScoresKey(date, state), scores);
      console.log(`Arquivados ${scores.length} scores de ${state} -- ${date}`);
    }

    const ids = rows.map((r) => r.id);
    const BATCH = 500;
    for (let i = 0; i < ids.length; i += BATCH) {
      await db.query(`delete from risk_scores where id = any($1::uuid[])`, [ids.slice(i, i + BATCH)]);
    }
    console.log(`Removidos ${ids.length} registros de ${state} do Supabase.`);
  }
}

async function createDailySnapshot(db: Pool): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().slice(0, 10);

  const { rows } = await db.query<RiskScoreRow>(
    `select rs.id, rs.score, rs.level, rs.rain_1h, rs.rain_72h, rs.rain_peak_3h,
            rs.tide_level, rs.auto_critical, rs.auto_critical_reason, rs.rain_source,
            rs.calculated_at, rs.neighborhood_id,
            n.name as neighborhood_name, n.name_source, n.centroid_lat, n.centroid_lng,
            c.name as city_name, c.state
     from risk_scores rs
     join neighborhoods n on n.id = rs.neighborhood_id
     join cities c on c.id = n.city_id
     where rs.calculated_at >= $1::date and rs.calculated_at < ($1::date + interval '1 day')`,
    [date]
  );

  if (rows.length === 0) {
    console.log(`Sem dados pra snapshot de ${date}`);
    return;
  }

  interface Aggregate {
    name: string;
    city: string;
    state: string;
    lat: number | null;
    lng: number | null;
    scores: number[];
    max_score: number;
    max_rain_72h: number;
    had_critical: boolean;
  }
  const byNeighborhood = new Map<string, Aggregate>();

  for (const row of rows) {
    let agg = byNeighborhood.get(row.neighborhood_id);
    if (!agg) {
      agg = {
        name: row.neighborhood_name,
        city: row.city_name,
        state: row.state,
        lat: row.centroid_lat,
        lng: row.centroid_lng,
        scores: [],
        max_score: 0,
        max_rain_72h: 0,
        had_critical: false,
      };
      byNeighborhood.set(row.neighborhood_id, agg);
    }
    agg.scores.push(row.score);
    agg.max_score = Math.max(agg.max_score, row.score);
    agg.max_rain_72h = Math.max(agg.max_rain_72h, row.rain_72h ?? 0);
    if (row.level === "critical") agg.had_critical = true;
  }

  const snapshot = {
    date,
    generated_at: new Date().toISOString(),
    total_neighborhoods: byNeighborhood.size,
    neighborhoods: Array.from(byNeighborhood.entries()).map(([id, agg]) => ({
      id,
      ...agg,
      avg_score: agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length,
      readings: agg.scores.length,
    })),
  };

  await saveToB2(getSnapshotKey(date), snapshot);
  console.log(`Snapshot de ${date} salvo -- ${snapshot.total_neighborhoods} bairros`);
}

// Retenção em 2 níveis (ver migração 034_merge_cache_retention.sql): célula
// perto de bairro (lida de verdade pelo score, ver lib/merge.ts) guarda 7
// dias; o resto do bbox nacional (grade retangular que nunca é lida por
// nenhum bairro real) guarda só 3. is_near_neighborhood default é `false`
// pra qualquer linha gravada antes dessa migração/antes do
// fetch_merge_cptec.py passar a marcar a coluna -- tratada aqui como "far"
// (retenção mais curta), um default conservador razoável pra dado ainda
// não classificado.
const MERGE_CACHE_NEAR_RETENTION_DAYS = 7;
const MERGE_CACHE_FAR_RETENTION_DAYS = 3;

async function archiveMergeCache(db: Pool): Promise<void> {
  const { rows } = await db.query(
    `select * from merge_cache
     where (is_near_neighborhood = true and fetched_at < now() - interval '${MERGE_CACHE_NEAR_RETENTION_DAYS} days')
        or (is_near_neighborhood = false and fetched_at < now() - interval '${MERGE_CACHE_FAR_RETENTION_DAYS} days')
     limit 50000`
  );
  if (rows.length === 0) {
    console.log("merge_cache: nada pra arquivar.");
    return;
  }

  // data_date já é a data de referência da célula (não fetched_at) -- mesmo
  // particionamento que archiveRiskScores usa pra risk_scores.
  //
  // ATENÇÃO -- lê o arquivo existente antes de gravar (igual archiveCronStats
  // abaixo), NÃO um saveToB2 direto. O LIMIT desta query (50000) é bem menor
  // que o total de células elegíveis num backlog real -- rodar este script
  // várias vezes até drenar tudo é o caso normal, não excepcional. Um
  // saveToB2 direto SOBRESCREVE o arquivo do dia inteiro a cada rodada; como
  // as células já foram apagadas do Postgres na rodada anterior, elas
  // seriam perdidas de vez (aconteceu de verdade rodando isso a primeira
  // vez, antes desta correção -- ver relatório).
  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const date = new Date(row.data_date).toISOString().slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(row);
  }
  for (const [date, cells] of Array.from(byDate)) {
    const key = getMergeCacheKey(date);
    const existing = await readFromB2<typeof rows>(key);
    await saveToB2(key, [...(existing ?? []), ...cells]);
    console.log(`Arquivadas ${cells.length} células de merge_cache -- ${date}`);
  }

  const ids = rows.map((r) => r.id);
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    await db.query(`delete from merge_cache where id = any($1::uuid[])`, [ids.slice(i, i + BATCH)]);
  }
  console.log(`merge_cache: ${rows.length} células arquivadas no B2 e removidas do Supabase.`);
}

const WEATHER_CACHE_RETENTION_HOURS = 24;

async function archiveWeatherCache(db: Pool): Promise<void> {
  // "<> (select max(fetched_at) ... where city_id = wc.city_id)" protege a
  // leitura mais recente de CADA cidade -- é o que o app serve como "agora"
  // pro clima atual (ver lib/weather.ts, getWeatherFromCacheOnly). Sem essa
  // condição, uma cidade cujo Cron B não atualiza há mais de
  // WEATHER_CACHE_RETENTION_HOURS (falha de API, rate limit) perderia a
  // única leitura que tem -- mesmo bug que scripts/maintenance.sql já
  // corrigiu pra limpeza manual; aqui é a mesma proteção pro archiving
  // automático.
  const { rows } = await db.query(
    `select * from weather_cache wc
     where fetched_at < now() - interval '${WEATHER_CACHE_RETENTION_HOURS} hours'
       and fetched_at <> (select max(fetched_at) from weather_cache wc2 where wc2.city_id = wc.city_id)
     limit 50000`
  );
  if (rows.length === 0) {
    console.log("weather_cache: nada pra arquivar.");
    return;
  }

  // Particionado pela data real de fetched_at de cada linha (não "ontem"
  // fixo) -- se o archiving ficar mais de 1 dia sem rodar, as linhas
  // acumuladas cobrem várias datas distintas, e lumpar tudo num arquivo só
  // rotulado "ontem" perderia a granularidade diária dos outros tipos
  // arquivados aqui. Lê o arquivo existente antes de gravar (mesmo motivo
  // do merge_cache acima) -- o LIMIT de 50000 desta query também pode
  // precisar de várias rodadas pra drenar um backlog grande.
  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const date = new Date(row.fetched_at).toISOString().slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(row);
  }
  for (const [date, readings] of Array.from(byDate)) {
    const key = getWeatherCacheKey(date);
    const existing = await readFromB2<typeof rows>(key);
    await saveToB2(key, [...(existing ?? []), ...readings]);
    console.log(`Arquivados ${readings.length} registros de weather_cache -- ${date}`);
  }

  const ids = rows.map((r) => r.id);
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    await db.query(`delete from weather_cache where id = any($1::uuid[])`, [ids.slice(i, i + BATCH)]);
  }
  console.log(`weather_cache: ${rows.length} registros arquivados no B2 e removidos do Supabase.`);
}

const CRON_STATS_RETENTION_DAYS = 14;

async function archiveCronStats(db: Pool): Promise<void> {
  // Coluna real é completed_at, não created_at (conferido no schema --
  // scripts/sql/017_layered_fallback.sql).
  const { rows } = await db.query(
    `select * from cron_run_stats where completed_at < now() - interval '${CRON_STATS_RETENTION_DAYS} days'`
  );
  if (rows.length === 0) {
    console.log("cron_run_stats: nada pra arquivar.");
    return;
  }

  const byMonth = new Map<string, typeof rows>();
  for (const row of rows) {
    const month = new Date(row.completed_at).toISOString().slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(row);
  }
  for (const [month, monthRows] of Array.from(byMonth)) {
    const key = getCronStatsKey(month);
    const existing = await readFromB2<typeof rows>(key);
    await saveToB2(key, [...(existing ?? []), ...monthRows]);
    console.log(`Arquivados ${monthRows.length} registros de cron_run_stats -- ${month}`);
  }

  const ids = rows.map((r) => r.id);
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    await db.query(`delete from cron_run_stats where id = any($1::uuid[])`, [ids.slice(i, i + BATCH)]);
  }
  console.log(`cron_run_stats: ${rows.length} registros arquivados no B2 e removidos do Supabase.`);
}

const B2_FILE_RETENTION_YEARS = 1;

async function cleanB2OldFiles(): Promise<void> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - B2_FILE_RETENTION_YEARS);

  const prefixes = ["risk_scores", "merge_cache", "weather_cache", "snapshots/daily"];
  let deleted = 0;

  for (const prefix of prefixes) {
    const files = await listB2Files(prefix);
    for (const file of files) {
      const dateMatch = file.match(/(\d{4})\/(\d{2})\/(\d{2})/);
      if (!dateMatch) continue;

      const fileDate = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
      if (fileDate < cutoff) {
        await deleteFromB2(file);
        deleted++;
        console.log(`B2: deletado arquivo antigo ${file}`);
      }
    }
  }
  console.log(`B2 cleanup: ${deleted} arquivos com mais de ${B2_FILE_RETENTION_YEARS} ano(s) removidos.`);
}

async function main() {
  const db = getDb();
  try {
    await archiveRiskScores(db);
    await archiveMergeCache(db);
    await archiveWeatherCache(db);
    await archiveCronStats(db);
    await cleanB2OldFiles();
    await createDailySnapshot(db);
    console.log("Archiving concluído.");
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
