import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";
import { getDb } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth";
import { acquireLock, releaseLock, SCORES_CRON_LOCK_KEY } from "@/lib/systemLock";
import { runWithConcurrency, scoreCity } from "@/lib/riskScoring";
import { handleApiError } from "@/lib/apiError";
import { readFromB2, getNeighborhoodsCacheKey } from "@/lib/b2";
import { resetStagnantMergeCellCount, getStagnantMergeCellCount } from "@/lib/weather";
import type { City, Neighborhood } from "@/types";

interface NeighborhoodsCache {
  generated_at: string;
  count: number;
  neighborhoods: Neighborhood[];
}

// Cache de neighborhoods no B2 em vez de ler a tabela inteira do Postgres
// toda hora (diagnóstico de egress de 29/07/2026 -- essa query sozinha
// custava ~240MB/dia mesmo já só com as 10 colunas do fix anterior).
// Regenerado 1x/dia (scripts/generate_neighborhoods_cache.ts, ver
// .github/workflows/regenerate-neighborhoods-cache.yml) -- bairro/cidade
// recém-cadastrado só aparece aqui depois da próxima regeneração ou de um
// workflow_dispatch manual. Sem cache em memória de módulo: este endpoint só
// roda 1x/hora via GitHub Actions, então cada invocação bate num cold start
// (ou numa instância serverless diferente) de qualquer forma -- um cache em
// memória nunca teria hit na prática, só complicaria o código à toa.
async function getNeighborhoods(db: Pool): Promise<Neighborhood[]> {
  try {
    const cached = await readFromB2<NeighborhoodsCache>(getNeighborhoodsCacheKey());
    if (cached) {
      console.log(`[cron/scores] neighborhoods do cache B2: ${cached.count} bairros (gerado em ${cached.generated_at})`);
      return cached.neighborhoods;
    }
  } catch (err) {
    console.warn("[cron/scores] Falha ao ler cache B2 -- fallback pro banco:", err);
  }

  console.warn("[cron/scores] Cache B2 indisponível ou vazio -- lendo neighborhoods do Postgres");
  const { rows } = await db.query<Neighborhood>(
    `select id, city_id, name, name_source, centroid_lat, centroid_lng,
            terrain_slope, hydro_proximity, is_coastal, created_at
     from neighborhoods`
  );
  return rows;
}

// Cron A -- recalcula risk_scores pra TODOS os bairros a partir do que já
// está em weather_cache/merge_cache, sem nenhuma chamada externa (ver
// docs/architecture/diagnostico_cron_arquitetura.md sobre o incidente de rate-limit
// em cascata de 23/07/2026 que motivou separar isso do Cron B, que é quem
// de fato mantém weather_cache atualizado). Meta: < 5min pra base nacional
// inteira -- só leitura de cache + cálculo + insert em lote, sem esperar
// nenhuma API de clima responder. scoreCity mora em lib/riskScoring.ts
// (reaproveitada por app/api/cron/scores/emergency/route.ts).
const CITY_CONCURRENCY = 8;

// SCORES_CRON_LOCK_KEY (lib/systemLock.ts) -- app/api/cron/scores/emergency/
// route.ts adquire o MESMO lock antes de rodar scoreCity(), pra não competir
// com este cron horário escrevendo risk_scores/risk_events pros mesmos
// bairros ao mesmo tempo. Não exportado direto daqui porque route.ts só
// pode exportar handlers HTTP reconhecidos (GET, POST etc.) -- exportar uma
// const comum quebra a checagem de tipos gerada pelo Next.js pra esse arquivo.
const LOCK_KEY = SCORES_CRON_LOCK_KEY;
// 20min -- folga real acima do timeout do workflow (--max-time 570s = 9.5min,
// ver merge-and-scores-update.yml). Com TTL=10min, uma execução legítima só
// um pouco mais lenta que o normal (banco sob carga, por exemplo) já fazia o
// lock expirar como "stale" antes da execução terminar, permitindo uma
// segunda instância duplicar a rodada inteira (achado em 08/08, 2 horas com
// score em dobro pra todo o Brasil).
const LOCK_MAX_AGE_MINUTES = 20;

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const start = Date.now();
  const db = getDb();

  try {
    const acquired = await acquireLock(db, { key: LOCK_KEY, lockedBy: "cron_scores", maxAgeMinutes: LOCK_MAX_AGE_MINUTES });
    if (!acquired) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Já existe um ciclo em andamento (lock < 20min)" });
    }
  } catch (err) {
    return handleApiError(err, "api/cron/scores");
  }

  try {
    await cleanupExpiredReports(db);
    resetStagnantMergeCellCount();

    const { rows: cities } = await db.query<City>(
      "select id, name, state, lat, lng, tide_code, data_level, active, created_at from cities where active = true"
    );
    const allNeighborhoods = await getNeighborhoods(db);

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

    const stagnantMergeCells = getStagnantMergeCellCount();
    if (stagnantMergeCells > 0) {
      console.warn(
        `[cron/scores] ${stagnantMergeCells} células MERGE estagnadas há >24h nesta rodada -- Open-Meteo priorizado para essas regiões`
      );
    }

    return NextResponse.json({
      ok: true,
      total_cities: cities.length,
      total_neighborhoods_scored: totalScored,
      cities_with_errors: citiesWithErrors,
      stagnant_merge_cells: stagnantMergeCells,
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

