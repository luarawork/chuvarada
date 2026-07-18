import { InfoButton } from "@/components/ui/InfoButton";
import { METRIC_INFO } from "@/lib/metricInfo";
import { calculateScore } from "@/lib/score";
import type { ForecastResult, ForecastSlot, Neighborhood, RiskScore } from "@/types";

const ICON_EMOJI: Record<string, string> = {
  "01": "☀️",
  "02": "🌤",
  "03": "☁️",
  "04": "☁️",
  "09": "🌧",
  "10": "🌦",
  "11": "⛈",
  "13": "❄️",
  "50": "🌫",
};

const LEVEL_EMOJI = { normal: "🟢", attention: "🟡", critical: "🔴" };

function emojiForIcon(icon: string): string {
  return ICON_EMOJI[icon.slice(0, 2)] ?? "🌡";
}

function formatHour(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit" }).replace(":00", "h");
}

// Estima o score de risco pra um horário futuro usando a chuva prevista pra
// aquele intervalo (a API só dá passos de 3 em 3 horas, então rain_intensity
// e rain_1h viram uma média por hora dentro do passo). Maré usa o nível
// atual como aproximação, já que não temos previsão de maré. É uma
// estimativa, não o dado observado que o score "oficial" do bairro usa.
function predictSlotScore(
  neighborhood: Pick<Neighborhood, "terrain_slope" | "hydro_proximity" | "is_coastal">,
  currentScore: RiskScore,
  slot: ForecastSlot,
  rain72hSoFar: number
) {
  const rainIntensity = slot.rain / 3;
  return calculateScore(
    neighborhood,
    {
      rain_1h: rainIntensity,
      rain_3h: slot.rain,
      rain_72h: rain72hSoFar,
      rain_intensity: rainIntensity,
      wind_speed: slot.wind_speed,
      wind_direction: 0,
      humidity: slot.humidity,
      pressure: slot.pressure,
      pressure_trend: "stable",
    },
    currentScore.tide_level
  );
}

interface ForecastStripProps {
  forecast: ForecastResult | null;
  loading: boolean;
  neighborhood: Neighborhood;
  currentScore: RiskScore | null;
}

export function ForecastStrip({ forecast, loading, neighborhood, currentScore }: ForecastStripProps) {
  let cumulativeRain = currentScore?.rain_72h ?? 0;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-sm font-medium text-brand-gray-urban/70">Previsão do tempo</h3>
        <InfoButton title={METRIC_INFO.forecast.title} description={METRIC_INFO.forecast.description} />
      </div>

      {loading && <p className="text-xs text-brand-gray-urban/50">Carregando previsão...</p>}

      {!loading && !forecast && (
        <p className="text-xs text-brand-gray-urban/50">Não foi possível carregar a previsão agora.</p>
      )}

      {forecast && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <div className="flex min-w-[76px] flex-col items-center gap-1 rounded-xl bg-brand-blue-mid/10 px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-blue-mid">
              Agora
            </span>
            <span className="text-xl">{emojiForIcon(forecast.current.icon)}</span>
            <span className="text-sm font-semibold text-brand-gray-urban">{forecast.current.temp}°</span>
            {forecast.current.rain > 0 && (
              <span className="text-[10px] text-brand-gray-urban/60">{forecast.current.rain.toFixed(1)}mm</span>
            )}
          </div>

          {forecast.next12h.map((slot) => {
            cumulativeRain += slot.rain;
            const predicted = currentScore
              ? predictSlotScore(neighborhood, currentScore, slot, cumulativeRain)
              : null;

            return (
              <div
                key={slot.time}
                className="flex min-w-[68px] flex-col items-center gap-1 rounded-xl bg-brand-gray-light px-3 py-2.5"
              >
                <span className="text-[11px] text-brand-gray-urban/60">{formatHour(slot.time)}</span>
                <span className="text-xl">{emojiForIcon(slot.icon)}</span>
                <span className="text-sm font-semibold text-brand-gray-urban">{slot.temp}°</span>
                {slot.pop > 0 && (
                  <span className="text-[10px] text-brand-blue-mid">{Math.round(slot.pop * 100)}% chuva</span>
                )}
                {predicted && (
                  <span className="mt-0.5 flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] text-brand-gray-urban/70">
                    {LEVEL_EMOJI[predicted.level]} {predicted.score.toFixed(2)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-1.5 text-[10px] text-brand-gray-urban/45">
        "% chuva" é a chance de chover no período. O selo colorido é uma estimativa do risco com base na
        previsão — o score principal do bairro usa dado observado, não previsto.
      </p>
    </div>
  );
}
