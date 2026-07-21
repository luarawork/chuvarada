import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOpenMeteoLimiterStats } from "@/lib/weather";
import { getWeatherApiLimiterStats } from "@/lib/weatherapi";

// Monitoramento da estratégia de fallback em camadas (ver lib/weather.ts):
// consumo diário de cada API de clima e a distribuição por camada do ciclo
// mais recente do cron. Os contadores de rate limit são só em memória do
// processo (não sobrevivem a um cold start serverless) -- o "last_cycle"
// vem do banco (cron_run_stats, escrito por app/api/cron/update/route.ts)
// justamente por isso: é a única fonte confiável em produção.
export async function GET() {
  const openMeteo = getOpenMeteoLimiterStats();
  const weatherApi = getWeatherApiLimiterStats();

  const db = getDb();
  const { rows } = await db.query(
    `select total_cities, openmeteo_count, weatherapi_fallback_count, cache_emergency_count, neutral_fallback_count, completed_at
     from cron_run_stats
     order by completed_at desc
     limit 1`
  );
  const lastCycle = rows[0] ?? null;

  return NextResponse.json({
    openmeteo: {
      calls_today: openMeteo.callsToday,
      limit: openMeteo.limit,
      percentage: openMeteo.percentage,
      status: openMeteo.status,
    },
    weatherapi: {
      calls_today: weatherApi.callsToday,
      limit: weatherApi.limit,
      percentage: weatherApi.percentage,
      status: weatherApi.status,
    },
    last_cycle: lastCycle
      ? {
          total_cities: lastCycle.total_cities,
          openmeteo: lastCycle.openmeteo_count,
          weatherapi_fallback: lastCycle.weatherapi_fallback_count,
          cache_emergency: lastCycle.cache_emergency_count,
          neutral_fallback: lastCycle.neutral_fallback_count,
          completed_at: lastCycle.completed_at,
        }
      : null,
  });
}
