import { InfoButton } from "@/components/ui/InfoButton";
import { METRIC_INFO } from "@/lib/metricInfo";
import type { ForecastResult } from "@/types";

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

function emojiForIcon(icon: string): string {
  return ICON_EMOJI[icon.slice(0, 2)] ?? "🌡";
}

function formatHour(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit" }).replace(":00", "h");
}

interface ForecastStripProps {
  forecast: ForecastResult | null;
  loading: boolean;
}

export function ForecastStrip({ forecast, loading }: ForecastStripProps) {
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

          {forecast.next12h.map((slot) => (
            <div
              key={slot.time}
              className="flex min-w-[68px] flex-col items-center gap-1 rounded-xl bg-brand-gray-light px-3 py-2.5"
            >
              <span className="text-[11px] text-brand-gray-urban/60">{formatHour(slot.time)}</span>
              <span className="text-xl">{emojiForIcon(slot.icon)}</span>
              <span className="text-sm font-semibold text-brand-gray-urban">{slot.temp}°</span>
              {slot.pop > 0 && (
                <span className="text-[10px] text-brand-blue-mid">{Math.round(slot.pop * 100)}%</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
