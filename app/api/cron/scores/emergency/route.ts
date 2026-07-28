import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth";
import { rejectIfPayloadTooLarge, handleApiError } from "@/lib/apiError";
import { scoreCity } from "@/lib/riskScoring";
import { acquireLock, releaseLock, SCORES_CRON_LOCK_KEY } from "@/lib/systemLock";
import type { City, Neighborhood } from "@/types";

// Adquire o MESMO lock do Cron A (scores/route.ts) -- sem isso, uma chuva
// intensa detectada bem no meio do ciclo horário disparava scoreCity() pros
// mesmos bairros em paralelo com o cron regular, arriscando intercalar
// escritas em risk_scores/risk_events (ver docs/revisao_qualidade.md,
// achado 🟡 #5). maxAgeMinutes curto (5min) porque uma emergência real
// precisa ser rápida -- se o lock não solta em 5min, algo travou e vale
// mais deixar a próxima chamada tentar de novo do que ficar bloqueado.
const EMERGENCY_LOCK_MAX_AGE_MINUTES = 5;

// Recálculo imediato pra bairros perto de células com chuva intensa (ver
// scripts/fetch_merge_cptec.py) -- disparado pelo próprio fetch, sem
// esperar o próximo ciclo horário do Cron A. Mesma pipeline de scoreCity
// (reaproveitada de app/api/cron/scores/route.ts), só que escopada aos
// bairros afetados em vez da base nacional inteira.
//
// "Perto" usa a MESMA fórmula de snap pra grade nativa do MERGE (origem
// -120.05/-60.05, passo 0.1) que scripts/sql/034_merge_cache_retention.sql
// usa pra popular merge_cache_cells -- garante que "célula intensa" e
// "bairro nessa célula" concordam sobre o que é a mesma célula.
const MAX_CELLS_PER_REQUEST = 500;

interface IntenseCell {
  grid_lat: number;
  grid_lng: number;
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const tooLarge = rejectIfPayloadTooLarge(req, 200 * 1024);
  if (tooLarge) return tooLarge;

  const body = await req.json().catch(() => null);
  const cells: IntenseCell[] = body?.cells;
  if (!Array.isArray(cells) || cells.length === 0) {
    return NextResponse.json({ error: "cells (array não vazio) é obrigatório" }, { status: 400 });
  }
  if (cells.length > MAX_CELLS_PER_REQUEST) {
    return NextResponse.json({ error: `no máximo ${MAX_CELLS_PER_REQUEST} células por chamada` }, { status: 400 });
  }
  if (!cells.every((c) => typeof c.grid_lat === "number" && typeof c.grid_lng === "number")) {
    return NextResponse.json({ error: "cada célula precisa de grid_lat e grid_lng numéricos" }, { status: 400 });
  }

  const db = getDb();

  const acquired = await acquireLock(db, {
    key: SCORES_CRON_LOCK_KEY,
    lockedBy: "cron_scores_emergency",
    maxAgeMinutes: EMERGENCY_LOCK_MAX_AGE_MINUTES,
  });
  if (!acquired) {
    console.log("[cron/scores/emergency] Cron horário em execução -- emergência adiada");
    return NextResponse.json({ ok: true, deferred: true });
  }

  try {
    const glats = cells.map((c) => c.grid_lat);
    const glngs = cells.map((c) => c.grid_lng);

    // geometry:geometry_simplified -- mesmo motivo do Cron A
    // (app/api/cron/scores/route.ts): coluna geometry crua não existe mais
    // desde a migração 032_remove_raw_geometry.sql.
    const { rows: neighborhoods } = await db.query<Neighborhood>(
      `select distinct n.id, n.city_id, n.name, n.name_source, n.geometry_simplified as geometry,
              n.terrain_slope, n.hydro_proximity, n.is_coastal, n.created_at
       from neighborhoods n
       join unnest($1::float[], $2::float[]) as ic(glat, glng)
         on round((round(((n.centroid_lat - (-60.05)) / 0.1)::numeric) * 0.1 + (-60.05))::numeric, 4)::float = ic.glat
        and round((round(((n.centroid_lng - (-120.05)) / 0.1)::numeric) * 0.1 + (-120.05))::numeric, 4)::float = ic.glng`,
      [glats, glngs]
    );

    if (neighborhoods.length === 0) {
      return NextResponse.json({ ok: true, affected: 0 });
    }

    const cityIds = Array.from(new Set(neighborhoods.map((n) => n.city_id)));
    const { rows: cities } = await db.query<City>(`select * from cities where id = any($1::uuid[])`, [cityIds]);

    const neighborhoodsByCity = new Map<string, Neighborhood[]>();
    for (const n of neighborhoods) {
      // geometry_simplified pode voltar como string dependendo do driver --
      // mesma normalização de app/api/neighborhoods/route.ts.
      if (typeof n.geometry === "string") n.geometry = JSON.parse(n.geometry);
      if (!neighborhoodsByCity.has(n.city_id)) neighborhoodsByCity.set(n.city_id, []);
      neighborhoodsByCity.get(n.city_id)!.push(n);
    }

    let totalScored = 0;
    for (const city of cities) {
      totalScored += await scoreCity(db, city, neighborhoodsByCity.get(city.id) ?? []);
    }

    return NextResponse.json({ ok: true, affected: neighborhoods.length, cities_affected: cities.length, scored: totalScored });
  } catch (err) {
    return handleApiError(err, "api/cron/scores/emergency");
  } finally {
    await releaseLock(db, SCORES_CRON_LOCK_KEY);
  }
}
