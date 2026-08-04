import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";
import { getDb } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth";
import { acquireLock, releaseLock } from "@/lib/systemLock";
import { handleApiError } from "@/lib/apiError";
import { findBestStation, fetchTideSeries } from "@/lib/tidecheck";

// Cron dedicado de maré (TideCheck) -- mantém tidecheck_cache atualizado
// dentro da cota gratuita de 50 requisições/dia. 115 cidades costeiras
// (tide_code cadastrado) tornam "1 requisição/cidade/dia" inviável (115 >
// 50, e cada cidade custaria 2 chamadas na primeira vez: achar estação +
// buscar maré). Em vez disso:
//
// 1. Atribuição de estação (findBestStation) é feita 1x por cidade, pra
//    sempre -- gravada em cities.tide_station_id, não re-buscada depois.
// 2. Cada busca de maré (fetchTideSeries) traz ~10 dias de série prevista
//    de uma vez, cacheada em tidecheck_cache até perto do fim dessa janela
//    -- o nível "agora" é sempre interpolado da série já em cache (ver
//    lib/cptec.ts:getTideCheckLevel), nenhuma leitura de score chama a API.
//
// BUDGET_PER_RUN divide a cota entre as duas fases a cada execução --
// prioriza atribuir estação (sem isso nada mais funciona pra aquela
// cidade), depois reabastece a série das cidades mais perto de vencer.
// Nos primeiros ~3 dias, o backlog de atribuição consome quase todo o
// budget; depois disso, o regime permanente de reabastecimento (~13-15
// cidades/dia pra manter as 115 sempre com série válida por ~9 dias) fica
// bem abaixo do teto.
const BUDGET_PER_RUN = 45;
const REFRESH_MARGIN_DAYS = 2; // reabastece quando faltam menos de 2 dias de série

// 45 chamadas sequenciais pro TideCheck levaram ~58s numa execução real de
// teste (só fase de atribuição de estação) -- acima do limite padrão de
// função serverless da Vercel. Sem efeito fora da Vercel (GitHub Actions
// já usa --max-time 570 no workflow).
export const maxDuration = 120;

const LOCK_KEY = "tide_cron_running";
const LOCK_MAX_AGE_MINUTES = 25;

interface CoastalCity {
  id: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  tide_station_id: string | null;
}

async function getCitiesNeedingStation(db: Pool, limit: number): Promise<CoastalCity[]> {
  const { rows } = await db.query(
    `select id, name, state, lat, lng, tide_station_id
     from cities
     where active = true and tide_code is not null and tide_station_id is null
     order by name
     limit $1`,
    [limit]
  );
  return rows;
}

async function getCitiesNeedingTideRefresh(db: Pool, limit: number): Promise<CoastalCity[]> {
  const { rows } = await db.query(
    `select c.id, c.name, c.state, c.lat, c.lng, c.tide_station_id
     from cities c
     left join tidecheck_cache t on t.city_id = c.id
     where c.active = true and c.tide_code is not null and c.tide_station_id is not null
       and (t.city_id is null or t.series_ends_at < now() + interval '${REFRESH_MARGIN_DAYS} days')
     order by t.series_ends_at asc nulls first
     limit $1`,
    [limit]
  );
  return rows;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const start = Date.now();
  const db = getDb();

  try {
    const acquired = await acquireLock(db, { key: LOCK_KEY, lockedBy: "cron_tide", maxAgeMinutes: LOCK_MAX_AGE_MINUTES });
    if (!acquired) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Já existe um ciclo em andamento (lock < 25min)" });
    }
  } catch (err) {
    return handleApiError(err, "api/cron/tide");
  }

  let budgetRemaining = BUDGET_PER_RUN;
  const result = {
    stations_assigned: 0,
    stations_failed: 0,
    tides_refreshed: 0,
    tides_failed: 0,
    details: [] as Record<string, unknown>[],
  };

  try {
    // Fase 1: atribuir estação pras cidades que ainda não têm.
    const needingStation = await getCitiesNeedingStation(db, budgetRemaining);
    for (const city of needingStation) {
      if (budgetRemaining <= 0) break;
      budgetRemaining--;
      try {
        const station = await findBestStation(city.lat, city.lng);
        if (!station) {
          result.stations_failed++;
          console.warn(`[cron/tide] Sem estação encontrada pra ${city.name}/${city.state}`);
          continue;
        }
        await db.query(
          `update cities set tide_station_id = $1, tide_station_type = $2, tide_station_distance_km = $3 where id = $4`,
          [station.id, station.type, station.distanceKm, city.id]
        );
        result.stations_assigned++;
        result.details.push({
          city: `${city.name}/${city.state}`,
          phase: "assign",
          station: station.id,
          type: station.type,
          distance_km: station.distanceKm,
        });
      } catch (err) {
        result.stations_failed++;
        console.error(`[cron/tide] Erro atribuindo estação pra ${city.name}/${city.state}:`, err);
      }
    }

    // Fase 2: reabastecer série de maré das cidades já com estação
    // atribuída, mais perto de vencer primeiro, com o que sobrar do budget.
    if (budgetRemaining > 0) {
      const needingRefresh = await getCitiesNeedingTideRefresh(db, budgetRemaining);
      for (const city of needingRefresh) {
        if (budgetRemaining <= 0) break;
        budgetRemaining--;
        try {
          const series = await fetchTideSeries(city.tide_station_id!);
          if (!series) {
            result.tides_failed++;
            console.warn(`[cron/tide] Sem série de maré pra ${city.name}/${city.state} (${city.tide_station_id})`);
            continue;
          }
          await db.query(
            `insert into tidecheck_cache (city_id, station_id, station_type, height_min, height_max, time_series, fetched_at, series_ends_at)
             values ($1, $2, $3, $4, $5, $6, now(), $7)
             on conflict (city_id) do update set
               station_id = excluded.station_id, station_type = excluded.station_type,
               height_min = excluded.height_min, height_max = excluded.height_max,
               time_series = excluded.time_series, fetched_at = excluded.fetched_at,
               series_ends_at = excluded.series_ends_at`,
            [city.id, series.stationId, series.stationType, series.heightMin, series.heightMax, JSON.stringify(series.timeSeries), series.seriesEndsAt]
          );
          result.tides_refreshed++;
          result.details.push({
            city: `${city.name}/${city.state}`,
            phase: "refresh",
            station: series.stationId,
            type: series.stationType,
            series_ends_at: series.seriesEndsAt,
          });
        } catch (err) {
          result.tides_failed++;
          console.error(`[cron/tide] Erro atualizando série pra ${city.name}/${city.state}:`, err);
        }
      }
    }

    console.log(
      `[cron/tide] Concluído: ${result.stations_assigned} estações atribuídas, ` +
      `${result.tides_refreshed} séries atualizadas, budget usado: ${BUDGET_PER_RUN - budgetRemaining}/${BUDGET_PER_RUN}`
    );

    return NextResponse.json({
      ok: true,
      ...result,
      budget_used: BUDGET_PER_RUN - budgetRemaining,
      budget_total: BUDGET_PER_RUN,
      duration_ms: Date.now() - start,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return handleApiError(err, "api/cron/tide");
  } finally {
    await releaseLock(db, LOCK_KEY);
  }
}
