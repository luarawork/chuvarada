import { useRiskForecast, type RiskForecastDay } from "@/hooks/useRiskForecast";
import { LEVEL_EMOJI, LEVEL_TEXT_CLASS } from "@/lib/constants";

const DAY_LABELS = ["Hoje", "Amanhã", "+2", "+3", "+4", "+5", "+6"];

function formatScoreBr(score: number): string {
  return score.toFixed(2).replace(".", ",");
}

interface DailyForecastProps {
  neighborhoodId: string;
}

export function DailyForecast({ neighborhoodId }: DailyForecastProps) {
  const { forecast, loading, error } = useRiskForecast(neighborhoodId, true);

  if (loading) return <p className="text-xs text-brand-blue-light/60">Carregando previsão...</p>;
  if (error) return <p className="text-xs text-brand-red-alert">{error}</p>;
  if (!forecast) return null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1">
        {forecast.map((day: RiskForecastDay, i: number) => (
          <div key={day.date} className="flex flex-col items-center gap-1">
            <span className="text-[11px] text-brand-blue-light/70">{DAY_LABELS[i] ?? `+${i}`}</span>
            <span className="text-lg" style={{ opacity: day.confidence }}>
              {LEVEL_EMOJI[day.level]}
            </span>
            <span
              className={`text-xs font-mono font-semibold ${LEVEL_TEXT_CLASS[day.level]}`}
              style={{ opacity: day.confidence }}
            >
              {formatScoreBr(day.score)}
            </span>
            <span className="text-[10px] text-brand-blue-light/50">
              {day.rain_peak_3h > 0 ? `${day.rain_peak_3h}mm` : "—"}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-brand-blue-light/60">Alta</span>
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-brand-blue-mid/15">
          <div className="h-full w-full rounded-full bg-gradient-to-r from-brand-blue-mid to-brand-blue-mid/10" />
        </div>
        <span className="text-[10px] text-brand-blue-light/60">Menor</span>
      </div>

      <p className="text-[11px] leading-relaxed text-brand-blue-light/60">
        ⚠️ Previsão meteorológica. Incerteza aumenta com o tempo.
      </p>
    </div>
  );
}
