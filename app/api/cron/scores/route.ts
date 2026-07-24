import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";
import { getDb } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth";
import { isLocked, acquireLock, releaseLock } from "@/lib/systemLock";
import { getWeatherFromCacheOnly } from "@/lib/weather";
import { getMergeData } from "@/lib/merge";
import { getTideLevelCacheOnly } from "@/lib/cptec";
import { calculateScore } from "@/lib/score";
import { groupNeighborhoodsByCell } from "@/lib/cellGrouping";
import {
  runWithConcurrency,
  mapWithConcurrency,
  insertRiskScoresBatch,
  syncRiskEventsBatch,
  upsertCityRiskSummary,
  type ScoredRow,
} from "@/lib/riskScoring";
import { handleApiError } from "@/lib/apiError";
import type { City, Neighborhood } from "@/types";

// Cron A -- recalcula risk_scores pra TODOS os bairros a partir do que já
// está em weather_cache/merge_cache, sem nenhuma chamada externa (ver
// scripts/diagnostico_cron_arquitetura.md sobre o incidente de rate-limit
// em cascata de 23/07/2026 que motivou separar isso do Cron B, que é quem
// de fato mantém weather_cache atualizado). Meta: < 5min pra base nacional
// inteira -- só leitura de cache + cálculo + insert em lote, sem esperar
// nenhuma API de clima responder.
const CITY_CONCURRENCY = 8;
const CELL_CONCURRENCY = 4;

const LOCK_KEY = "scores_cron_running";
const LOCK_MAX_AGE_MINUTES = 10;

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const start = Date.now();
  const db = getDb();

  try {
    if (await isLocked(db, LOCK_KEY, LOCK_MAX_AGE_MINUTES)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Já existe um ciclo em andamento (lock < 10min)" });
    }
    await acquireLock(db, { key: LOCK_KEY, lockedBy: "cron_scores" });
  } catch (err) {
    return handleApiError(err, "api/cron/scores");
  }

  try {
    await cleanupExpiredReports(db);

    const { rows: cities } = await db.query<City>("select * from cities where active = true");
    const { rows: allNeighborhoods } = await db.query<Neighborhood>("select * from neighborhoods");

    const neighborhoodsByCity = new Map<string, Neighborhood[]>();
    for (const n of allNeighborhoods) {
      if (!neighborhoodsByCity.has(n.city_id)) neighborhoodsByCity.set(n.city_id, []);
      neighborhoodsByCity.get(n.city_id)!.push(n);
    }

    let totalScored = 0;
    let citiesWithErrors = 0;

    await runWithConcurrency(cities, CITY_CONCURRENCY, async (city) => {
      try {
        totalScored += await scoreCity(db, city, neighborhoodsByCity.get(city.id) ?? []);
      } catch (err) {
        citiesWithErrors++;
        console.error(`[cron/scores] Erro ao processar ${city.name}:`, err);
      }
    });

    return NextResponse.json({
      ok: true,
      total_cities: cities.length,
      total_neighborhoods_scored: totalScored,
      cities_with_errors: citiesWithErrors,
      duration_ms: Date.now() - start,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return handleApiError(err, "api/cron/scores");
  } finally {
    await releaseLock(db, LOCK_KEY);
  }
}

// Marca como "expired" relatos cuja expires_at já passou -- roda aqui (Cron
// A, a cada ciclo curto) em vez de um cron separado só pra isso, já que o
// custo é um único UPDATE indexado (ver user_reports_status).
async function cleanupExpiredReports(db: Pool): Promise<void> {
  await db.query(
    `update user_reports set status = 'expired'
     where status = 'active' and expires_at < now()`
  );
}

async function scoreCity(db: Pool, city: City, neighborhoods: Neighborhood[]): Promise<number> {
  if (neighborhoods.length === 0) return 0;

  const tide = await getTideLevelCacheOnly(city.id, city.tide_code);
  const cells = groupNeighborhoodsByCell(city, neighborhoods);

  const weatherByCell = await mapWithConcurrency(cells, CELL_CONCURRENCY, async (cell) => {
    const merge = await getMergeData(cell.lat, cell.lng).catch(() => null);
    return getWeatherFromCacheOnly(city.id, cell.lat, cell.lng, merge);
  });

  const tideLevelForScore = city.tide_code ? tide.level : null;

  const scoredRows: ScoredRow[] = [];
  for (let i = 0; i < cells.length; i++) {
    const weather = weatherByCell[i];
    for (const neighborhood of cells[i].neighborhoods) {
      const result = calculateScore(neighborhood, weather, tideLevelForScore, tide.cached_at);
      scoredRows.push({ neighborhood, weather, result });
    }
  }

  await insertRiskScoresBatch(db, scoredRows, tide.level);
  await syncRiskEventsBatch(db, scoredRows);
  await upsertCityRiskSummary(db, city, scoredRows);

  return scoredRows.length;
}
