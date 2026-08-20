import type { Pool } from "pg";
import { calculateScore } from "./score";
import { getWeatherFromCacheOnly } from "./weather";
import { getMergeData } from "./merge";
import { getTideLevelCacheOnly } from "./cptec";
import { groupNeighborhoodsByCell } from "./cellGrouping";
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
  const hasHigh = rows.some((r) => r.result.level === "high");
  const hasModerate = rows.some((r) => r.result.level === "moderate");
  const hasAttention = rows.some((r) => r.result.level === "attention");
  const worstLevel = hasCritical ? "critical" : hasHigh ? "high" : hasModerate ? "moderate" : hasAttention ? "attention" : "normal";
  // Rescala 2026-08-09: city_risk_summary continua só com 2 colunas de
  // contagem (critical_count/attention_count, sem migração pra 5 colunas
  // pedida no rollout) -- critical_count agora agrega high+critical,
  // attention_count agrega attention+moderate, preservando o par
  // "grave"/"leve" que a UI (app/favoritos, cards de cidade) já lê.
  const criticalCount = rows.filter((r) => r.result.level === "critical" || r.result.level === "high").length;
  const attentionCount = rows.filter((r) => r.result.level === "attention" || r.result.level === "moderate").length;

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
    const base = idx * 18;
    values.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},` +
        `$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17},$${base + 18})`
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
      weather.soil_moisture,
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

  // ON CONFLICT casa com o índice único risk_scores_neighborhood_hour_uniq
  // (migração 040) -- defesa em profundidade contra duplicata de bairro na
  // mesma hora se o lock do Cron A falhar de novo por outro motivo (ver
  // LOCK_MAX_AGE_MINUTES em app/api/cron/scores/route.ts pra causa raiz).
  await db.query(
    `insert into risk_scores (
       neighborhood_id, score, level, rain_1h, rain_72h, rain_intensity, rain_peak_3h, rain_source,
       terrain_slope, soil_moisture, hydro_proximity, tide_level, wind_speed, wind_direction,
       humidity, pressure, auto_critical, auto_critical_reason
     ) values ${values.join(", ")}
     on conflict (neighborhood_id, (date_trunc('hour', calculated_at at time zone 'utc'))) do nothing`,
    params
  );
}

export async function syncRiskEventsBatch(db: Pool, rows: ScoredRow[]): Promise<void> {
  if (rows.length === 0) return;

  const neighborhoodIds = rows.map((r) => r.neighborhood.id);
  const { rows: openEvents } = await db.query(
    `select id, neighborhood_id, level, peak_score, started_at, ended_at, confirmed
     from risk_events where neighborhood_id = any($1::uuid[]) and ended_at is null`,
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

// Extraído de app/api/cron/scores/route.ts (Cron A) pra ser reaproveitado
// por app/api/cron/scores/emergency/route.ts sem duplicar a pipeline
// (clima -> score -> insert em lote -> risk_events -> city_risk_summary).
// Precisou virar lib/ (não só um export a mais no route.ts) porque rotas
// do App Router só podem exportar handlers HTTP reconhecidos (GET, POST
// etc.) -- exportar uma função qualquer quebra a checagem de tipos gerada
// pelo Next.js pra arquivos route.ts.
export async function scoreCity(db: Pool, city: City, neighborhoods: Neighborhood[]): Promise<number> {
  if (neighborhoods.length === 0) return 0;

  const tide = await getTideLevelCacheOnly(city.id, city.tide_code);
  const cells = groupNeighborhoodsByCell(city, neighborhoods);

  const CELL_CONCURRENCY = 4;
  const weatherByCell = await mapWithConcurrency(cells, CELL_CONCURRENCY, async (cell) => {
    const merge = await getMergeData(cell.lat, cell.lng).catch(() => null);
    return getWeatherFromCacheOnly(city.id, cell.lat, cell.lng, merge);
  });

  const tideLevelForScore = city.tide_code ? tide.level : null;

  const scoredRows: ScoredRow[] = [];
  for (let i = 0; i < cells.length; i++) {
    const weather = weatherByCell[i];
    for (const neighborhood of cells[i].neighborhoods) {
      const result = calculateScore(neighborhood, weather, tideLevelForScore, tide.cached_at, city.state);
      scoredRows.push({ neighborhood, weather, result });
    }
  }

  const previousLevels = await getPreviousLevels(db, scoredRows);

  await insertRiskScoresBatch(db, scoredRows, tide.level);
  await syncRiskEventsBatch(db, scoredRows);
  await upsertCityRiskSummary(db, city, scoredRows);
  notifyLevelChanges(city, scoredRows, previousLevels);

  return scoredRows.length;
}

// Nível anterior de cada bairro (antes do insert desta rodada), pra detectar
// quem realmente MUDOU pra atenção/crítico -- consulta latest_risk_scores
// (migração 020) porque é exatamente "1 linha mais recente por bairro",
// sem precisar de DISTINCT ON manual aqui.
async function getPreviousLevels(db: Pool, rows: ScoredRow[]): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();
  const ids = rows.map((r) => r.neighborhood.id);
  const { rows: previous } = await db.query<{ neighborhood_id: string; level: string }>(
    `select neighborhood_id, level from latest_risk_scores where neighborhood_id = any($1::uuid[])`,
    [ids]
  );
  return new Map(previous.map((p) => [p.neighborhood_id, p.level]));
}

// Dispara /api/push/send pros bairros que acabaram de entrar em atenção/
// crítico nesta rodada (nível anterior era diferente do novo). Fire-and-
// forget de propósito (.catch, sem await no chamador) -- ver seção 3 do
// pedido original: um push que falha (rede, VAPID mal configurada) não pode
// derrubar o cron de scores, que precisa terminar mesmo sem push nenhum
// funcionando. /api/push/send já resolve rápido (0 subscriptions) pra
// bairros sem ninguém inscrito, então chamar pra todo mundo que mudou de
// nível é barato mesmo hoje, com poucos usuários inscritos.
function notifyLevelChanges(city: City, rows: ScoredRow[], previousLevels: Map<string, string>): void {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return; // sem secret configurada, nem tenta (mesmo fail-closed de verifyCronSecret)
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const changed = rows.filter(({ neighborhood, result }) => {
    // Qualquer nível acima de "normal" notifica (mesma filosofia de antes da
    // rescala, que cobria attention/critical -- os únicos 2 níveis não-normais
    // que existiam); moderate/high mapeiam pros toggles existentes em
    // app/api/push/send/route.ts.
    if (result.level === "normal") return false;
    return previousLevels.get(neighborhood.id) !== result.level;
  });

  for (const { neighborhood, result } of changed) {
    fetch(`${appUrl}/api/push/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cronSecret}` },
      body: JSON.stringify({
        neighborhoodId: neighborhood.id,
        level: result.level,
        neighborhoodName: neighborhood.name,
        cityName: city.name,
      }),
    }).catch((err) => console.error(`[riskScoring] push/send falhou pro bairro ${neighborhood.id}:`, err));
  }
}
