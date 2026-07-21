import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import type { Pool } from "pg";
import { getDb } from "@/lib/db";
import { getWeatherForPoint } from "@/lib/weather";
import { getCurrentTideLevel } from "@/lib/cptec";
import { calculateScore } from "@/lib/score";
import { gridCell, gridCellKey } from "@/lib/grid";
import type { City, Neighborhood, NormalizedWeather } from "@/types";

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

// Roda a cada hora (configurado externamente — Vercel Cron ou similar).
// Protegido por CRON_SECRET no header Authorization.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const db = getDb();

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

  return NextResponse.json({ ok: true, processed: summary, at: new Date().toISOString() });
}

async function runWithConcurrency<T>(
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

async function mapWithConcurrency<T, R>(
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

interface ScoredRow {
  neighborhood: Neighborhood;
  weather: NormalizedWeather;
  result: ReturnType<typeof calculateScore>;
}

async function processCity(db: Pool, city: City, neighborhoods: Neighborhood[]): Promise<number> {
  const tide = await getCurrentTideLevel(city.id, city.tide_code);

  // Bairros próximos caem na mesma célula de ~10km e reaproveitam o mesmo
  // clima — em vez de um único ponto (centro da cidade) pra todos os
  // bairros, o que fazia Salvador/Natal inteiras mostrarem a mesma chuva
  // independente de onde o bairro fica.
  const cellGroups = new Map<string, { lat: number; lng: number; neighborhoods: Neighborhood[] }>();
  for (const neighborhood of neighborhoods) {
    const centroid = turf.centroid(neighborhood.geometry as GeoJSON.Geometry);
    const [lng, lat] = centroid.geometry.coordinates;
    const cell = gridCell(lat, lng);
    const key = gridCellKey(cell);

    if (!cellGroups.has(key)) {
      cellGroups.set(key, { lat: cell.lat, lng: cell.lng, neighborhoods: [] });
    }
    cellGroups.get(key)!.neighborhoods.push(neighborhood);
  }

  // Se a cidade não tem bairro nenhum ainda (ex: São Luís), ainda buscamos
  // o clima do centro da cidade pra manter weather_cache populado (usado em
  // telas que mostram o clima da cidade sem bairro).
  if (cellGroups.size === 0) {
    await getWeatherForPoint(city.id, city.lat, city.lng);
    return 0;
  }

  // Busca o clima das células em paralelo (limitado) — antes era sequencial
  // e cidades com muitas células (Salvador tem 19) levavam dezenas de
  // segundos só nessa parte.
  const cells = Array.from(cellGroups.values());
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

  return scoredRows.length;
}

async function insertRiskScoresBatch(db: Pool, rows: ScoredRow[], tideLevel: number): Promise<void> {
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

async function syncRiskEventsBatch(db: Pool, rows: ScoredRow[]): Promise<void> {
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
