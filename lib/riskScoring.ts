import type { Pool } from "pg";
import { calculateScore } from "./score";
import type { City, Neighborhood, NormalizedWeather } from "@/types";

// Extraído de app/api/cron/update/route.ts pra ser reaproveitado pelo Cron A
// (app/api/cron/scores/route.ts) sem duplicar a lógica de gravação --
// comportamento idêntico ao cron legado, só compartilhado entre rotas.

export interface ScoredRow {
  neighborhood: Neighborhood;
  weather: NormalizedWeather;
  result: ReturnType<typeof calculateScore>;
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    await worker(items[current]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    results[current] = await worker(items[current]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}

// Atualiza o agregado por cidade usado pelo modo "pontos" do mapa no
// zoom-out (city_risk_summary, ver migração 022) direto a partir de
// `scoredRows` -- já temos o score/level de CADA bairro da cidade em
// memória aqui, então isso não é uma query nova nenhuma, só um upsert de 1
// linha. Ver comentário da migração: calcular esse agregado ao vivo por
// request (LATERAL ou merge join sobre risk_scores inteira) media 1-3s pra
// poucas centenas de cidades -- rápido demais de repetir a cada
// cron, devagar demais pra manter o mapa interativo.
export async function upsertCityRiskSummary(db: Pool, city: City, rows: ScoredRow[]): Promise<void> {
  if (rows.length === 0) return;

  const maxScore = Math.max(...rows.map((r) => r.result.score));
  const hasCritical = rows.some((r) => r.result.level === "critical");
  const hasAttention = rows.some((r) => r.result.level === "attention");
  const worstLevel = hasCritical ? "critical" : hasAttention ? "attention" : "normal";
  const criticalCount = rows.filter((r) => r.result.level === "critical").length;
  const attentionCount = rows.filter((r) => r.result.level === "attention").length;

  await db.query(
    `insert into city_risk_summary (
       city_id, name, state, lat, lng, data_level,
       max_score, worst_level, critical_count, attention_count, last_updated, refreshed_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
     on conflict (city_id) do update set
       name = excluded.name,
       state = excluded.state,
       lat = excluded.lat,
       lng = excluded.lng,
       data_level = excluded.data_level,
       max_score = excluded.max_score,
       worst_level = excluded.worst_level,
       critical_count = excluded.critical_count,
       attention_count = excluded.attention_count,
       last_updated = excluded.last_updated,
       refreshed_at = excluded.refreshed_at`,
    [city.id, city.name, city.state, city.lat, city.lng, city.data_level, maxScore, worstLevel, criticalCount, attentionCount]
  );
}

export async function insertRiskScoresBatch(db: Pool, rows: ScoredRow[], tideLevel: number): Promise<void> {
  if (rows.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];
  rows.forEach(({ neighborhood, weather, result }, idx) => {
    const base = idx * 17;
    values.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},` +
        `$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17})`
    );
    params.push(
      neighborhood.id,
      result.score,
      result.level,
      weather.rain_1h,
      weather.rain_72h,
      weather.rain_intensity,
      weather.rain_peak_3h,
      weather.rain_source,
      neighborhood.terrain_slope,
      neighborhood.hydro_proximity,
      tideLevel,
      weather.wind_speed,
      weather.wind_direction,
      weather.humidity,
      weather.pressure,
      result.auto_critical,
      result.auto_critical_reason
    );
  });

  await db.query(
    `insert into risk_scores (
       neighborhood_id, score, level, rain_1h, rain_72h, rain_intensity, rain_peak_3h, rain_source,
       terrain_slope, hydro_proximity, tide_level, wind_speed, wind_direction,
       humidity, pressure, auto_critical, auto_critical_reason
     ) values ${values.join(", ")}`,
    params
  );
}

export async function syncRiskEventsBatch(db: Pool, rows: ScoredRow[]): Promise<void> {
  if (rows.length === 0) return;

  const neighborhoodIds = rows.map((r) => r.neighborhood.id);
  const { rows: openEvents } = await db.query(
    `select * from risk_events where neighborhood_id = any($1::uuid[]) and ended_at is null`,
    [neighborhoodIds]
  );
  const openByNeighborhood = new Map(openEvents.map((e) => [e.neighborhood_id, e]));

  const toInsert: { neighborhoodId: string; level: string; score: number }[] = [];
  const toClose: string[] = [];

  for (const { neighborhood, result } of rows) {
    const openEvent = openByNeighborhood.get(neighborhood.id);
    if (result.level === "critical") {
      if (!openEvent) {
        toInsert.push({ neighborhoodId: neighborhood.id, level: result.level, score: result.score });
      } else if (result.score > (openEvent.peak_score ?? 0)) {
        await db.query(`update risk_events set peak_score = $1 where id = $2`, [result.score, openEvent.id]);
      }
    } else if (openEvent) {
      toClose.push(openEvent.id);
    }
  }

  if (toInsert.length > 0) {
    const values: string[] = [];
    const params: unknown[] = [];
    toInsert.forEach(({ neighborhoodId, level, score }, idx) => {
      const base = idx * 3;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      params.push(neighborhoodId, level, score);
    });
    await db.query(
      `insert into risk_events (neighborhood_id, level, peak_score) values ${values.join(", ")}`,
      params
    );
  }

  if (toClose.length > 0) {
    await db.query(`update risk_events set ended_at = now() where id = any($1::uuid[])`, [toClose]);
  }
}
