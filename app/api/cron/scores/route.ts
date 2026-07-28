import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";
import { getDb } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth";
import { acquireLock, releaseLock, SCORES_CRON_LOCK_KEY } from "@/lib/systemLock";
import { runWithConcurrency, scoreCity } from "@/lib/riskScoring";
import { handleApiError } from "@/lib/apiError";
import type { City, Neighborhood } from "@/types";

// Cron A -- recalcula risk_scores pra TODOS os bairros a partir do que já
// está em weather_cache/merge_cache, sem nenhuma chamada externa (ver
// docs/diagnostico_cron_arquitetura.md sobre o incidente de rate-limit
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
const LOCK_MAX_AGE_MINUTES = 10;

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const start = Date.now();
  const db = getDb();

  try {
    const acquired = await acquireLock(db, { key: LOCK_KEY, lockedBy: "cron_scores", maxAgeMinutes: LOCK_MAX_AGE_MINUTES });
    if (!acquired) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Já existe um ciclo em andamento (lock < 10min)" });
    }
  } catch (err) {
    return handleApiError(err, "api/cron/scores");
  }

  try {
    await cleanupExpiredReports(db);

    const { rows: cities } = await db.query<City>("select * from cities where active = true");
    // geometry:geometry_simplified -- coluna geometry crua foi removida na
    // migração 032_remove_raw_geometry.sql; um `select *` aqui deixa
    // neighborhood.geometry undefined e derruba groupNeighborhoodsByCell
    // (turf.centroid) pra toda cidade com mais de LARGE_CITY_THRESHOLD
    // bairros -- mesma convenção de alias usada em app/api/neighborhoods e
    // app/api/score.
    const { rows: allNeighborhoods } = await db.query<Neighborhood>(
      `select id, city_id, name, name_source, geometry_simplified as geometry,
              terrain_slope, hydro_proximity, is_coastal, created_at
       from neighborhoods`
    );

    const neighborhoodsByCity = new Map<string, Neighborhood[]>();
    for (const n of allNeighborhoods) {
      // geometry_simplified pode voltar como string dependendo do driver --
      // mesma normalização de app/api/neighborhoods/route.ts.
      if (typeof n.geometry === "string") n.geometry = JSON.parse(n.geometry);
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

