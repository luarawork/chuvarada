import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";
import { getDb } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth";
import { getWeatherForPoint, resetCycleStats, getCycleStats } from "@/lib/weather";
import { getCurrentTideLevel } from "@/lib/cptec";
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
import type { City, Neighborhood } from "@/types";

// ATENÇÃO (23/07/2026): este cron está sendo substituído por dois cronos
// independentes -- app/api/cron/scores (recalcula a partir do cache, rápido)
// e app/api/cron/weather (atualiza weather_cache aos poucos, sem nunca
// processar a base inteira de uma vez). Motivo: rodar busca de clima E
// cálculo de score no mesmo ciclo faz a base INTEIRA precisar de clima
// fresco de uma vez sempre que o weather_cache expira nacionalmente --
// nesse cenário o Open-Meteo passa a limitar taxa (HTTP 429) em praticamente
// toda célula, tornando o ciclo inviável (~900 scores em 40min pra 28.483
// bairros, ver scripts/diagnostico_cron_arquitetura.md). Mantido por ora
// (ver plano de depreciação no mesmo diagnóstico) só como fallback manual --
// os workflows do GitHub Actions já usam os 2 cronos novos.
//
// Cidades processadas em paralelo (limitado pelo max do pool em lib/db.ts).
// Com ~1800 cidades ativas (expansão pro Nordeste inteiro), processar uma
// cidade de cada vez — como era antes — levava horas: cada bairro fazia 2-3
// round-trips sequenciais ao banco, e cidades com muitas células de clima
// (Salvador, Recife, cidades do Ceará) buscavam célula por célula em série.
//
// CITY_CONCURRENCY x CELL_CONCURRENCY é o teto de requisições simultâneas
// ao Open-Meteo — com CITY_CONCURRENCY=8 e todas as células de uma cidade
// em paralelo (sem teto), uma rajada passava de 100 requisições ao mesmo
// tempo e batia no limite de taxa (HTTP 429) da API gratuita.
const CITY_CONCURRENCY = 4;
const CELL_CONCURRENCY = 4;

// Lock de execução -- protege contra 2 disparos do cron rodando ao mesmo
// tempo (ex: disparo manual enquanto o agendado já está no meio do ciclo,
// que agora leva ~11min com a cobertura nacional -- ver relatório da
// expansão Sul+Sudeste). Sem isso, 2 ciclos concorrentes dobrariam o
// consumo de cota das APIs de clima à toa e poderiam gravar risk_scores
// inconsistentes (mesma classe de race condition do lock em merge_cache,
// ver lib/merge.ts e scripts/fetch_merge_cptec.py).
const CRON_LOCK_KEY = "cron_running";
const CRON_LOCK_MAX_AGE_MINUTES = 15;

async function isCronAlreadyRunning(db: Pool): Promise<boolean> {
  const { rows } = await db.query(`select locked_at from system_locks where key = $1`, [CRON_LOCK_KEY]);
  const lockRow = rows[0];
  if (!lockRow) return false;
  const ageMinutes = (Date.now() - new Date(lockRow.locked_at).getTime()) / 60000;
  return ageMinutes < CRON_LOCK_MAX_AGE_MINUTES;
}

async function acquireCronLock(db: Pool): Promise<void> {
  await db.query(
    `insert into system_locks (key, locked_at, locked_by) values ($1, now(), 'cron_update')
     on conflict (key) do update set locked_at = excluded.locked_at, locked_by = excluded.locked_by`,
    [CRON_LOCK_KEY]
  );
}

async function releaseCronLock(db: Pool): Promise<void> {
  await db.query(`delete from system_locks where key = $1`, [CRON_LOCK_KEY]);
}

// Roda a cada hora (configurado externamente — Vercel Cron ou similar).
// Protegido por CRON_SECRET no header Authorization.
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const db = getDb();

  if (await isCronAlreadyRunning(db)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Já existe um ciclo em andamento (lock < 15min)" });
  }

  await acquireCronLock(db);
  resetCycleStats();

  try {
    const { rows: cities } = await db.query<City>("select * from cities where active = true");
    const { rows: allNeighborhoods } = await db.query<Neighborhood>("select * from neighborhoods");

    const neighborhoodsByCity = new Map<string, Neighborhood[]>();
    for (const n of allNeighborhoods) {
      if (!neighborhoodsByCity.has(n.city_id)) neighborhoodsByCity.set(n.city_id, []);
      neighborhoodsByCity.get(n.city_id)!.push(n);
    }

    const summary: Record<string, number> = {};

    await runWithConcurrency(cities, CITY_CONCURRENCY, async (city) => {
      try {
        summary[city.name] = await processCity(db, city, neighborhoodsByCity.get(city.id) ?? []);
      } catch (err) {
        summary[city.name] = -1;
        console.error(`Erro ao processar ${city.name}:`, err);
      }
    });

    // Persiste o resumo por camada de fallback (ver lib/weather.ts) pra
    // alimentar GET /api/health -- os contadores de rate limit em si só
    // vivem em memória do processo (não sobrevivem a um cold start
    // serverless), então esta linha é a única forma confiável de saber, em
    // produção, como foi a distribuição de fontes do ciclo mais recente.
    const stats = getCycleStats();
    await db.query(
      `insert into cron_run_stats (total_cities, openmeteo_count, weatherapi_fallback_count, cache_emergency_count, neutral_fallback_count)
       values ($1, $2, $3, $4, $5)`,
      [cities.length, stats.openmeteo, stats.weatherapi_fallback, stats.cache_emergency, stats.neutral_fallback]
    );

    return NextResponse.json({ ok: true, processed: summary, weatherSources: stats, at: new Date().toISOString() });
  } finally {
    await releaseCronLock(db);
  }
}

async function processCity(db: Pool, city: City, neighborhoods: Neighborhood[]): Promise<number> {
  const tide = await getCurrentTideLevel(city.id, city.tide_code);
  const cells = groupNeighborhoodsByCell(city, neighborhoods);

  // Se a cidade não tem bairro nenhum ainda (ex: São Luís), ainda buscamos
  // o clima do centro da cidade pra manter weather_cache populado (usado em
  // telas que mostram o clima da cidade sem bairro).
  if (cells.length === 0) {
    await getWeatherForPoint(city.id, city.lat, city.lng);
    return 0;
  }

  // Busca o clima das células em paralelo (limitado) — antes era sequencial
  // e cidades com muitas células (Salvador tem 19) levavam dezenas de
  // segundos só nessa parte.
  const weatherByCell = await mapWithConcurrency(cells, CELL_CONCURRENCY, (cell) =>
    getWeatherForPoint(city.id, cell.lat, cell.lng)
  );

  // tide_code null = sem estação de maré nas proximidades — a variável não
  // entra no cálculo (peso redistribuído em lib/score.ts), em vez de usar o
  // 0.5 "neutro" que getCurrentTideLevel devolve só pra manter o retorno
  // numérico em outros usos (ex: armazenamento em risk_scores.tide_level).
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
