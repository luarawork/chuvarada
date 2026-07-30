import type { ForecastResult } from "@/types";

// Códigos de condição do tempo são WMO (weather_code da Open-Meteo), não
// mais os códigos de ícone da OpenWeatherMap.
const ICON_EMOJI: Record<number, string> = {
  0: "☀️",
  1: "🌤",
  2: "⛅",
  3: "☁️",
  45: "🌫",
  48: "🌫",
  51: "🌦",
  53: "🌦",
  55: "🌦",
  56: "🌦",
  57: "🌦",
  61: "🌧",
  63: "🌧",
  65: "🌧",
  66: "🌧",
  67: "🌧",
  71: "❄️",
  73: "❄️",
  75: "❄️",
  77: "❄️",
  80: "🌦",
  81: "🌧",
  82: "🌧",
  85: "❄️",
  86: "❄️",
  95: "⛈",
  96: "⛈",
  99: "⛈",
};

function emojiForIcon(icon: string): string {
  return ICON_EMOJI[Number(icon)] ?? "🌡";
}

function formatHour(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit" }).replace(":00", "h");
}

function rainLabel(rain: number): string {
  return rain > 0 ? `${Math.round(rain)}mm` : "0";
}

interface HourlyForecastProps {
  forecast: ForecastResult | null;
  loading: boolean;
}

export function HourlyForecast({ forecast, loading }: HourlyForecastProps) {
  if (loading) return <p className="text-xs text-brand-blue-light/60">Carregando previsão...</p>;
  if (!forecast) return <p className="text-xs text-brand-blue-light/60">Não foi possível carregar a previsão agora.</p>;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 rounded-xl bg-brand-blue-mid/20 px-2 py-2.5 md:w-14">
        <span className="text-xs font-semibold text-brand-blue-light">Agora</span>
        <span className="text-xl">{emojiForIcon(forecast.current.icon)}</span>
        <span className="text-[11px] text-brand-gray-light">{rainLabel(forecast.current.rain)}</span>
      </div>

      {forecast.next12h.map((slot) => (
        <div
          key={slot.time}
          className="flex w-12 shrink-0 flex-col items-center gap-1 rounded-xl bg-brand-blue-mid/10 px-2 py-2.5 md:w-14"
        >
          <span className="text-xs text-brand-blue-light">{formatHour(slot.time)}</span>
          <span className="text-xl">{emojiForIcon(slot.icon)}</span>
          <span className="text-[11px] text-brand-gray-light">{rainLabel(slot.rain)}</span>
        </div>
      ))}
    </div>
  );
}
