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
// Retenção reduzida de 48h pra 24h (10/08/2026, ver diagnóstico de espaço do
// banco -- risk_scores era a maior tabela, 507MB) -- MUDAR ESTE VALOR JUNTO
// com o mesmo ARCHIVE_CUTOFF_HOURS em app/api/history/route.ts: os dois
// precisam concordar sobre onde termina "recente" (Supabase) e começa
// "arquivado" (B2), senão o endpoint de histórico tenta ler do Supabase uma
// janela que este script já apagou.
//
// ATENÇÃO -- interação com a migração 004_retention.sql: aquela migração já
// faz downsampling de risk_scores via pg_cron dentro do próprio Supabase
// (granularidade plena só nas últimas 24h; 1 registro/hora até 14 dias; 1/dia
// depois disso), rodando toda noite às 03:00 UTC. Agora que o corte deste
// script TAMBÉM é 24h, os dois mecanismos disputam a mesma fronteira: quem
// rodar primeiro no dia "vence" essa janela (o outro não encontra mais nada
// pra processar ali, sem quebrar nada, só trabalho redundante). A pergunta
// que já estava em aberto antes -- se a 004 ainda faz sentido existir agora
// que o histórico completo vai pro B2 -- fica mais relevante ainda com os 2
// cortes iguais; não desativada aqui, decisão fora do escopo desta mudança.
const ARCHIVE_CUTOFF_HOURS = 24;

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

// Sem teto fixo por execução (ver diagnóstico de 03/08/2026 -- o limit de
// 10000/estado antigo empatava ou perdia da geração diária real, ~230-300 mil
// linhas/dia com os 28.483 bairros de cobertura nacional, deixando o backlog
// nunca drenar de verdade apesar do job reportar sucesso todo dia). Processa
// em lotes de RISK_SCORES_BATCH_SIZE até zerar o que está acima do corte,
// por estado.
const RISK_SCORES_BATCH_SIZE = 50_000;

async function archiveRiskScores(db: Pool): Promise<void> {
  for (const state of STATES) {
    let totalArchived = 0;

    while (true) {
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
         limit ${RISK_SCORES_BATCH_SIZE}`,
        [state]
      );

      if (rows.length === 0) break;

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
        // Leitura antes de gravar -- igual archiveMergeCache/archiveWeatherCache
        // abaixo. Sem isso, uma segunda passada no mesmo dia (necessária agora
        // que não há mais teto fixo -- um estado com backlog grande drena em
        // várias iterações do while) sobrescrevia o arquivo do dia inteiro,
        // perdendo os lotes já arquivados por iterações/execuções anteriores.
        // Dedup por id como proteção extra: se uma execução for reprocessada
        // depois de já ter arquivado mas falhado antes de deletar do Supabase,
        // o mesmo id não entra duplicado no arquivo.
        const key = getRiskScoresKey(date, state);
        const existing = await readFromB2<RiskScoreRow[]>(key);
        const existingIds = new Set((existing ?? []).map((s) => s.id));
        const newScores = scores.filter((s) => !existingIds.has(s.id));
        await saveToB2(key, [...(existing ?? []), ...newScores]);
        console.log(`Arquivados ${newScores.length} scores novos de ${state} -- ${date} (lote com ${scores.length})`);
      }

      const ids = rows.map((r) => r.id);
      const BATCH = 500;
      for (let i = 0; i < ids.length; i += BATCH) {
        await db.query(`delete from risk_scores where id = any($1::uuid[])`, [ids.slice(i, i + BATCH)]);
      }

      totalArchived += rows.length;
      console.log(`[${state}] arquivados ${totalArchived} scores até agora...`);

      // Veio menos que o lote pedido -- não há mais nada acima do corte
      // pra esse estado.
      if (rows.length < RISK_SCORES_BATCH_SIZE) break;
    }

    if (totalArchived > 0) {
      console.log(`${state}: ${totalArchived} scores arquivados no total no B2 e removidos do Supabase.`);
    }
  }

  const { rows: remainingRows } = await db.query<{ count: string }>(
    `select count(*) as count from risk_scores where calculated_at < now() - interval '${ARCHIVE_CUTOFF_HOURS} hours'`
  );
  const remaining = Number(remainingRows[0].count);
  console.log(`[archive] risk_scores restantes acima de ${ARCHIVE_CUTOFF_HOURS}h: ${remaining}`);
  if (remaining > 10_000) {
    console.warn(`[archive] ATENÇÃO -- risk_scores: backlog não zerado (${remaining} linhas ainda acima do corte).`);
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
    // Rescala 2026-08-09: high é o novo tier logo abaixo de critical (era só
    // attention antes) -- mantém had_critical marcando "situação grave" pra
    // não regredir silenciosamente o snapshot (mesma leitura de criticalCount
    // em lib/riskScoring.ts, ver comentário lá).
    if (row.level === "critical" || row.level === "high") agg.had_critical = true;
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
// perto de bairro (lida de verdade pelo score, ver lib/merge.ts) guarda 4
// dias; o resto do bbox nacional (grade retangular que nunca é lida por
// nenhum bairro real) guarda só 1 (reduzido de 7/3 em 26/07/2026 -- o banco
// bateu 502MB de novo com a retenção original, ver scripts/maintenance.sql).
// is_near_neighborhood default é `false` pra qualquer linha gravada antes
// dessa migração/antes do fetch_merge_cptec.py passar a marcar a coluna --
// tratada aqui como "far" (retenção mais curta), um default conservador
// razoável pra dado ainda não classificado.
const MERGE_CACHE_NEAR_RETENTION_DAYS = 4;
const MERGE_CACHE_FAR_RETENTION_DAYS = 1;

// Sem teto fixo por execução -- mesmo motivo de RISK_SCORES_BATCH_SIZE acima
// (diagnóstico de 03/08/2026: geração de merge_cache "far" chegou a 265 mil
// linhas/dia, bem acima do limit de 50000/execução antigo, que só processava
// uma fração do elegível por rodada e nunca zerava o backlog de verdade).
const MERGE_CACHE_BATCH_SIZE = 50_000;

async function archiveMergeCache(db: Pool): Promise<void> {
  let totalArchived = 0;

  while (true) {
    // Colunas explícitas em vez de `select *` (diagnóstico de egress de
    // 29/07/2026) -- lat/lng brutos são redundantes com grid_lat/grid_lng (a
    // identidade real da célula, usada em todo o resto do app); data_hour e
    // source ficam de fora do arquivo histórico (a maioria das células vem do
    // MERGE DAILY, que só publica 1x/dia -- data_hour carrega pouca
    // granularidade real pra essa fatia).
    const { rows } = await db.query(
      `select id, grid_lat, grid_lng, rain_72h, rain_peak_3h, data_date, is_near_neighborhood, fetched_at
       from merge_cache
       where (is_near_neighborhood = true and fetched_at < now() - interval '${MERGE_CACHE_NEAR_RETENTION_DAYS} days')
          or (is_near_neighborhood = false and fetched_at < now() - interval '${MERGE_CACHE_FAR_RETENTION_DAYS} days')
       limit ${MERGE_CACHE_BATCH_SIZE}`
    );
    if (rows.length === 0) break;

    // data_date já é a data de referência da célula (não fetched_at) -- mesmo
    // particionamento que archiveRiskScores usa pra risk_scores.
    //
    // Lê o arquivo existente antes de gravar, NÃO um saveToB2 direto. Agora
    // que o loop pode rodar várias iterações no mesmo dia pra um backlog
    // grande, um saveToB2 direto sobrescreveria o arquivo do dia a cada
    // iteração; como as células já foram apagadas do Postgres na iteração
    // anterior, seriam perdidas de vez (aconteceu de verdade rodando isso a
    // primeira vez, antes desta correção -- ver relatório).
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

    totalArchived += rows.length;
    console.log(`merge_cache: ${totalArchived} células arquivadas até agora...`);

    if (rows.length < MERGE_CACHE_BATCH_SIZE) break;
  }

  if (totalArchived === 0) {
    console.log("merge_cache: nada pra arquivar.");
  } else {
    console.log(`merge_cache: ${totalArchived} células arquivadas no total no B2 e removidas do Supabase.`);
  }

  const { rows: remainingRows } = await db.query<{ count: string }>(
    `select count(*) as count from merge_cache
     where (is_near_neighborhood = true and fetched_at < now() - interval '${MERGE_CACHE_NEAR_RETENTION_DAYS} days')
        or (is_near_neighborhood = false and fetched_at < now() - interval '${MERGE_CACHE_FAR_RETENTION_DAYS} days')`
  );
  const remaining = Number(remainingRows[0].count);
  console.log(`[archive] merge_cache restantes acima da retenção: ${remaining}`);
  if (remaining > 10_000) {
    console.warn(`[archive] ATENÇÃO -- merge_cache: backlog não zerado (${remaining} linhas ainda acima do corte).`);
  }
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
  // Colunas explícitas em vez de `select *` (diagnóstico de egress de
  // 29/07/2026) -- wind_speed/wind_direction/humidity/pressure ficam de fora
  // do arquivo histórico, mesmo raciocínio de app/api/cron/scores/route.ts:
  // variáveis secundárias, não usadas em nenhuma análise histórica hoje.
  const { rows } = await db.query(
    `select id, city_id, lat, lng, rain_1h, rain_72h, rain_intensity, rain_peak_3h,
            rain_source, weather_source, fetched_at
     from weather_cache wc
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
