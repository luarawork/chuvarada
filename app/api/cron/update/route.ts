import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { getWeatherForCity } from "@/lib/openweathermap";
import { getCurrentTideLevel } from "@/lib/cptec";
import { calculateScore } from "@/lib/score";
import type { City, Neighborhood, RiskLevel } from "@/types";

// Roda a cada 20 minutos (configurado externamente — Vercel Cron ou similar).
// Protegido por CRON_SECRET no header Authorization.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const db = getServerSupabase();

  const { data: cities, error: citiesError } = await db
    .from("cities")
    .select("*")
    .eq("active", true);

  if (citiesError) {
    return NextResponse.json({ error: citiesError.message }, { status: 500 });
  }

  const summary: Record<string, number> = {};

  for (const city of (cities as City[]) ?? []) {
    try {
      const weather = await getWeatherForCity(city.id, city.lat, city.lng);
      const tide = await getCurrentTideLevel(city.id, city.tide_code);

      const { data: neighborhoods, error: nError } = await db
        .from("neighborhoods")
        .select("*")
        .eq("city_id", city.id);

      if (nError) throw nError;

      let processed = 0;
      for (const neighborhood of (neighborhoods as Neighborhood[]) ?? []) {
        const result = calculateScore(neighborhood, weather, tide.level);

        await db.from("risk_scores").insert({
          neighborhood_id: neighborhood.id,
          score: result.score,
          level: result.level,
          rain_1h: weather.rain_1h,
          rain_72h: weather.rain_72h,
          rain_intensity: weather.rain_intensity,
          terrain_slope: neighborhood.terrain_slope,
          hydro_proximity: neighborhood.hydro_proximity,
          tide_level: tide.level,
          wind_speed: weather.wind_speed,
          wind_direction: weather.wind_direction,
          humidity: weather.humidity,
          pressure: weather.pressure,
          auto_critical: result.auto_critical,
          auto_critical_reason: result.auto_critical_reason,
        });

        await syncRiskEvent(db, neighborhood.id, result.level, result.score);
        processed++;
      }

      summary[city.name] = processed;
    } catch (err) {
      summary[city.name] = -1;
      console.error(`Erro ao processar ${city.name}:`, err);
    }
  }

  return NextResponse.json({ ok: true, processed: summary, at: new Date().toISOString() });
}

async function syncRiskEvent(
  db: ReturnType<typeof getServerSupabase>,
  neighborhoodId: string,
  level: RiskLevel,
  score: number
) {
  const { data: openEvent } = await db
    .from("risk_events")
    .select("*")
    .eq("neighborhood_id", neighborhoodId)
    .is("ended_at", null)
    .maybeSingle();

  if (level === "critical") {
    if (!openEvent) {
      await db.from("risk_events").insert({
        neighborhood_id: neighborhoodId,
        level,
        peak_score: score,
      });
    } else if (score > (openEvent.peak_score ?? 0)) {
      await db.from("risk_events").update({ peak_score: score }).eq("id", openEvent.id);
    }
  } else if (openEvent) {
    await db.from("risk_events").update({ ended_at: new Date().toISOString() }).eq("id", openEvent.id);
  }
}
