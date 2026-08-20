import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDailyRainForecast } from "@/lib/riskForecast";
import { calculateScore } from "@/lib/score";
import { getTideLevelCacheOnly } from "@/lib/cptec";
import { handleApiError } from "@/lib/apiError";
import type { NormalizedWeather } from "@/types";

// Mesmo padrão genérico (não específico de v4) já usado em
// app/api/push/subscribe/route.ts -- os UUIDs deste projeto não são
// garantidamente todos v4.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Previsão de RISCO pros próximos 7 dias, pro botão "Previsão →" do
// DetailPanel -- diferente de GET /api/forecast (só previsão do TEMPO,
// atual+12h, sem calculateScore). Usa Open-Meteo (única fonte com previsão
// futura de verdade -- MERGE/CPTEC só têm chuva já observada) combinado com
// as características estáticas do bairro (terrain_slope/hydro_proximity/
// is_coastal) pra estimar o score de cada dia.
export async function GET(req: NextRequest, context: { params: Promise<{ neighborhoodId: string }> }) {
  const { neighborhoodId } = await context.params;

  if (!UUID_RE.test(neighborhoodId)) {
    return NextResponse.json({ error: "ID de bairro inválido" }, { status: 400 });
  }

  try {
    const db = getDb();
    const { rows } = await db.query(
      `select n.id, n.terrain_slope, n.hydro_proximity, n.is_coastal,
              n.centroid_lat, n.centroid_lng,
              c.id as city_id, c.name as city_name, c.state, c.tide_code
       from neighborhoods n
       join cities c on c.id = n.city_id
       where n.id = $1`,
      [neighborhoodId]
    );

    const neighborhood = rows[0];
    if (!neighborhood) {
      return NextResponse.json({ error: "Bairro não encontrado" }, { status: 404 });
    }

    const dailyRain = await getDailyRainForecast(neighborhood.centroid_lat, neighborhood.centroid_lng);

    // Mesma lógica do score ao vivo (scoreCity em lib/riskScoring.ts):
    // getTideLevelCacheOnly já retorna o dado real do TideCheck quando a
    // cidade tem estação atribuída (CPTEC seguirá indisponível), caindo
    // pro neutro (0,5) só se não houver cache. Sem tide_code nenhum, null
    // redistribui o peso da maré entre as outras variáveis (ver
    // lib/score.ts) -- cidade sem litoral monitorado não deve carregar um
    // valor neutro como se fosse dado real.
    const tide = await getTideLevelCacheOnly(neighborhood.city_id, neighborhood.tide_code);
    const tideLevel: number | null = neighborhood.tide_code ? tide.level : null;

    const forecast = dailyRain.map((day) => {
      const weather: NormalizedWeather = {
        rain_1h: day.rain_max_1h,
        rain_3h: day.rain_peak_3h,
        rain_72h: day.rain_72h_accumulated,
        rain_intensity: day.rain_max_1h,
        rain_peak_3h: day.rain_peak_3h,
        rain_source: "openmeteo",
        wind_speed: 0,
        wind_direction: 0,
        humidity: 50,
        pressure: 1013,
        pressure_trend: "stable",
        // Sem previsão de soil_moisture pra dias futuros (Open-Meteo só dá
        // isso pro presente/passado recente) -- neutro, igual às outras
        // variáveis fixas desta previsão (vento/umidade/pressão).
        soil_moisture: 0.5,
      };

      // tideLastUpdated=null -- nunca deixa a Regra 2 (maré alta + chuva
      // costeira) disparar numa previsão futura, já que não existe tábua de
      // maré prevista confiável hoje (ver lib/score.ts, isTideDataRecent).
      const result = calculateScore(neighborhood, weather, tideLevel, null, neighborhood.state);

      return {
        date: day.date,
        score: result.score,
        level: result.level,
        auto_critical: result.auto_critical,
        rain_peak_3h: day.rain_peak_3h,
        rain_72h: day.rain_72h_accumulated,
        confidence: day.confidence,
      };
    });

    return NextResponse.json(
      {
        neighborhood_id: neighborhoodId,
        city: neighborhood.city_name,
        state: neighborhood.state,
        forecast,
        generated_at: new Date().toISOString(),
        disclaimer:
          "Previsão baseada em modelos meteorológicos. Incerteza aumenta com o tempo — não substitui alertas oficiais da Defesa Civil.",
      },
      {
        // 3h de cache -- previsão não muda a cada hora, e isso poupa cota
        // do Open-Meteo em reaberturas repetidas do mesmo bairro.
        headers: { "Cache-Control": "public, max-age=10800, stale-while-revalidate=3600" },
      }
    );
  } catch (err) {
    return handleApiError(err, "api/forecast/[neighborhoodId]");
  }
}
