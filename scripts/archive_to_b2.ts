import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import { saveToB2, getRiskScoresKey, getSnapshotKey } from "../lib/b2";

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

async function main() {
  const db = getDb();
  try {
    await archiveRiskScores(db);
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
