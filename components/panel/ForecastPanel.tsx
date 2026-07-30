import { useRiskForecast, type RiskForecastDay } from "@/hooks/useRiskForecast";
import type { RiskLevel } from "@/types";

const LEVEL_EMOJI: Record<RiskLevel, string> = { normal: "🟢", attention: "🟡", critical: "🔴" };
const LEVEL_TEXT_CLASS: Record<RiskLevel, string> = {
  normal: "text-brand-green-water",
  attention: "text-brand-yellow-warn",
  critical: "text-brand-red-alert",
};

const DAY_LABELS = ["Hoje", "Amanhã", "+2", "+3", "+4", "+5", "+6"];

function formatScoreBr(score: number): string {
  return score.toFixed(2).replace(".", ",");
}

interface ForecastPanelProps {
  neighborhoodId: string;
}

export function ForecastPanel({ neighborhoodId }: ForecastPanelProps) {
  const { forecast, loading, error } = useRiskForecast(neighborhoodId, true);

  if (loading) return <p className="text-xs text-brand-gray-urban/50">Carregando previsão...</p>;
  if (error) return <p className="text-xs text-brand-red-alert">{error}</p>;
  if (!forecast) return null;

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-7 gap-1">
        {forecast.map((day: RiskForecastDay, i: number) => (
          <div key={day.date} className="flex flex-col items-center gap-1">
            <span className="text-[10px] text-brand-gray-urban/60">{DAY_LABELS[i] ?? `+${i}`}</span>
            <span className="text-lg" style={{ opacity: day.confidence }}>
              {LEVEL_EMOJI[day.level]}
            </span>
            <span
              className={`text-xs font-mono font-semibold ${LEVEL_TEXT_CLASS[day.level]}`}
              style={{ opacity: day.confidence }}
            >
              {formatScoreBr(day.score)}
            </span>
            <span className="text-[10px] text-brand-gray-urban/50">
              {day.rain_peak_3h > 0 ? `${day.rain_peak_3h}mm` : "—"}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-brand-gray-urban/50">Confiança</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-brand-blue-mid/15">
          <div className="h-full w-full rounded-full bg-gradient-to-r from-brand-blue-mid to-brand-blue-mid/20" />
        </div>
        <span className="text-[10px] text-brand-gray-urban/40">menor →</span>
      </div>

      <p className="text-[10px] leading-relaxed text-brand-gray-urban/50">
        ⚠️ Previsão baseada em modelos meteorológicos. Incerteza aumenta com o tempo — não substitui alertas
        oficiais da Defesa Civil.
      </p>
    </div>
  );
}
