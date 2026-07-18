import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import type { Pool } from "pg";
import { getDb } from "@/lib/db";
import { getWeatherForPoint } from "@/lib/openweathermap";
import { getCurrentTideLevel } from "@/lib/cptec";
import { calculateScore } from "@/lib/score";
import { gridCell, gridCellKey } from "@/lib/grid";
import type { City, Neighborhood, RiskLevel } from "@/types";
import type { NormalizedWeather } from "@/types";

// Roda a cada 20 minutos (configurado externamente — Vercel Cron ou similar).
// Protegido por CRON_SECRET no header Authorization.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const db = getDb();

  const { rows: cities } = await db.query<City>("select * from cities where active = true");

  const summary: Record<string, number> = {};

  for (const city of cities) {
    try {
      const tide = await getCurrentTideLevel(city.id, city.tide_code);

      const { rows: neighborhoods } = await db.query<Neighborhood>(
        "select * from neighborhoods where city_id = $1",
        [city.id]
      );

      // Bairros próximos caem na mesma célula de ~5km e reaproveitam o
      // mesmo clima — em vez de um único ponto (centro da cidade) pra
      // todos os bairros, o que fazia Salvador/Natal inteiras mostrarem a
      // mesma chuva independente de onde o bairro fica.
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

      // Se a cidade não tem bairro nenhum ainda (ex: São Luís), ainda
      // buscamos o clima do centro da cidade pra manter weather_cache
      // populado (usado em telas que mostram o clima da cidade sem bairro).
      if (cellGroups.size === 0) {
        await getWeatherForPoint(city.id, city.lat, city.lng);
      }

      let processed = 0;
      for (const { lat, lng, neighborhoods: cellNeighborhoods } of Array.from(cellGroups.values())) {
        const weather = await getWeatherForPoint(city.id, lat, lng);

        for (const neighborhood of cellNeighborhoods) {
          const result = calculateScore(neighborhood, weather, tide.level);
          await insertRiskScore(db, neighborhood, weather, tide.level, result);
          await syncRiskEvent(db, neighborhood.id, result.level, result.score);
          processed++;
        }
      }

      summary[city.name] = processed;
    } catch (err) {
      summary[city.name] = -1;
      console.error(`Erro ao processar ${city.name}:`, err);
    }
  }

  return NextResponse.json({ ok: true, processed: summary, at: new Date().toISOString() });
}

async function insertRiskScore(
  db: Pool,
  neighborhood: Neighborhood,
  weather: NormalizedWeather,
  tideLevel: number,
  result: ReturnType<typeof calculateScore>
) {
  await db.query(
    `insert into risk_scores (
       neighborhood_id, score, level, rain_1h, rain_72h, rain_intensity,
       terrain_slope, hydro_proximity, tide_level, wind_speed, wind_direction,
       humidity, pressure, auto_critical, auto_critical_reason
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      neighborhood.id,
      result.score,
      result.level,
      weather.rain_1h,
      weather.rain_72h,
      weather.rain_intensity,
      neighborhood.terrain_slope,
      neighborhood.hydro_proximity,
      tideLevel,
      weather.wind_speed,
      weather.wind_direction,
      weather.humidity,
      weather.pressure,
      result.auto_critical,
      result.auto_critical_reason,
    ]
  );
}

async function syncRiskEvent(db: Pool, neighborhoodId: string, level: RiskLevel, score: number) {
  const { rows } = await db.query(
    `select * from risk_events where neighborhood_id = $1 and ended_at is null limit 1`,
    [neighborhoodId]
  );
  const openEvent = rows[0];

  if (level === "critical") {
    if (!openEvent) {
      await db.query(
        `insert into risk_events (neighborhood_id, level, peak_score) values ($1, $2, $3)`,
        [neighborhoodId, level, score]
      );
    } else if (score > (openEvent.peak_score ?? 0)) {
      await db.query(`update risk_events set peak_score = $1 where id = $2`, [score, openEvent.id]);
    }
  } else if (openEvent) {
    await db.query(`update risk_events set ended_at = now() where id = $1`, [openEvent.id]);
  }
}
