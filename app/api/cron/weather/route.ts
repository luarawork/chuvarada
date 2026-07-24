import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";
import { getDb } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth";
import { getWeatherForPoint, resetCycleStats, getCycleStats } from "@/lib/weather";
import { groupNeighborhoodsByCell } from "@/lib/cellGrouping";
import { runWithConcurrency, mapWithConcurrency } from "@/lib/riskScoring";
import type { City, Neighborhood } from "@/types";

// Cron B -- mantém weather_cache atualizado gradualmente, em lotes pequenos,
// nunca a base inteira de uma vez (isso é o que causava o rate-limit em
// cascata do Open-Meteo, ver scripts/diagnostico_cron_arquitetura.md). Roda
// a cada 30min (.github/workflows/weather-update.yml); o Cron A
// (app/api/cron/scores) só lê o que este cron já deixou em cache.
//
// Seleção de candidatos: cidades sem NENHUM weather_cache (nunca visitadas
// -- prioridade máxima, é o caso dos 917 municípios de Centro-Oeste/Norte
// recém-cadastrados) vêm primeiro (nulls first), seguidas das cidades com
// cache mais velho. O filtro de 3h é o mais conservador dos 2 limiares reais
// (3h chuva ativa / 24h parado, ver RAIN_ACTIVE_MAX_AGE_HOURS/
// SECONDARY_VARS_MAX_AGE_HOURS em lib/weather.ts) -- só decide QUEM entra
// nesta leva como candidato; getWeatherForPoint decide, célula por célula,
// se de fato precisa de uma chamada externa ou se o cache ainda vale (uma
// cidade "calma" com cache de 4h entra como candidata mas resulta em no-op,
// sem custo de API, só uma leitura de cache a mais).
const BATCH_SIZE = envIntOr(process.env.WEATHER_CRON_BATCH_SIZE, 150);
const CITY_CONCURRENCY = 10;
const CELL_CONCURRENCY = 4;
const CANDIDATE_MIN_AGE_HOURS = 3;

const LOCK_KEY = "weather_cron_running";
const LOCK_MAX_AGE_MINUTES = 25;

function envIntOr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function isAlreadyRunning(db: Pool): Promise<boolean> {
  const { rows } = await db.query(`select locked_at from system_locks where key = $1`, [LOCK_KEY]);
  const lockRow = rows[0];
  if (!lockRow) return false;
  const ageMinutes = (Date.now() - new Date(lockRow.locked_at).getTime()) / 60000;
  return ageMinutes < LOCK_MAX_AGE_MINUTES;
}

async function acquireLock(db: Pool): Promise<void> {
  await db.query(
    `insert into system_locks (key, locked_at, locked_by) values ($1, now(), 'cron_weather')
     on conflict (key) do update set locked_at = excluded.locked_at, locked_by = excluded.locked_by`,
    [LOCK_KEY]
  );
}

async function releaseLock(db: Pool): Promise<void> {
  await db.query(`delete from system_locks where key = $1`, [LOCK_KEY]);
}

interface CandidateCity extends City {
  last_cached: string | null;
}

async function getCitiesToUpdate(db: Pool, maxBatchSize: number): Promise<CandidateCity[]> {
  const { rows } = await db.query<CandidateCity>(
    `select c.*, (select max(fetched_at) from weather_cache w where w.city_id = c.id) as last_cached
     from cities c
     where c.active = true
       and (
         (select max(fetched_at) from weather_cache w where w.city_id = c.id) is null
         or (select max(fetched_at) from weather_cache w where w.city_id = c.id) < now() - interval '${CANDIDATE_MIN_AGE_HOURS} hours'
       )
     order by last_cached asc nulls first
     limit $1`,
    [maxBatchSize]
  );
  return rows;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const start = Date.now();
  const db = getDb();

  if (await isAlreadyRunning(db)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Já existe um ciclo em andamento (lock < 25min)" });
  }

  await acquireLock(db);
  resetCycleStats();

  try {
    const candidates = await getCitiesToUpdate(db, BATCH_SIZE);
    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, updated: 0, cities_processed: 0, reason: "Nada precisando de atualização" });
    }

    const cityIds = candidates.map((c) => c.id);
    const { rows: neighborhoods } = await db.query<Neighborhood>(
      `select * from neighborhoods where city_id = any($1::uuid[])`,
      [cityIds]
    );
    const neighborhoodsByCity = new Map<string, Neighborhood[]>();
    for (const n of neighborhoods) {
      if (!neighborhoodsByCity.has(n.city_id)) neighborhoodsByCity.set(n.city_id, []);
      neighborhoodsByCity.get(n.city_id)!.push(n);
    }

    let neverCachedCount = 0;
    let citiesWithErrors = 0;

    await runWithConcurrency(candidates, CITY_CONCURRENCY, async (city) => {
      if (city.last_cached === null) neverCachedCount++;
      try {
        const cells = groupNeighborhoodsByCell(city, neighborhoodsByCity.get(city.id) ?? []);
        if (cells.length === 0) {
          await getWeatherForPoint(city.id, city.lat, city.lng);
          return;
        }
        await mapWithConcurrency(cells, CELL_CONCURRENCY, (cell) => getWeatherForPoint(city.id, cell.lat, cell.lng));
      } catch (err) {
        citiesWithErrors++;
        console.error(`[cron/weather] Erro ao atualizar clima de ${city.name}:`, err);
      }
    });

    const stats = getCycleStats();
    await db.query(
      `insert into cron_run_stats (total_cities, openmeteo_count, weatherapi_fallback_count, cache_emergency_count, neutral_fallback_count)
       values ($1, $2, $3, $4, $5)`,
      [candidates.length, stats.openmeteo, stats.weatherapi_fallback, stats.cache_emergency, stats.neutral_fallback]
    );

    return NextResponse.json({
      ok: true,
      cities_processed: candidates.length,
      never_cached_processed: neverCachedCount,
      cities_with_errors: citiesWithErrors,
      weather_sources: stats,
      duration_ms: Date.now() - start,
      at: new Date().toISOString(),
    });
  } finally {
    await releaseLock(db);
  }
}
