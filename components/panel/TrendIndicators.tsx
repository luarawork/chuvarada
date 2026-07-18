import { InfoButton } from "@/components/ui/InfoButton";
import { METRIC_INFO } from "@/lib/metricInfo";
import type { RiskScore } from "@/types";

interface TrendIndicatorsProps {
  score: RiskScore;
  pressureTrend?: "falling" | "stable" | "rising";
}

const TREND_ICON = { falling: "↓", stable: "→", rising: "↑" };

export function TrendIndicators({ score, pressureTrend = "stable" }: TrendIndicatorsProps) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-brand-gray-light px-3 py-1 text-xs text-brand-gray-urban">
          💨 {score.wind_speed.toFixed(0)}km/h
          <InfoButton title={METRIC_INFO.wind.title} description={METRIC_INFO.wind.description} />
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-brand-gray-light px-3 py-1 text-xs text-brand-gray-urban">
          💧 {score.humidity.toFixed(0)}%
          <InfoButton title={METRIC_INFO.humidity.title} description={METRIC_INFO.humidity.description} />
        </span>
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
            pressureTrend === "falling"
              ? "bg-brand-yellow-warn/20 text-brand-yellow-warn"
              : "bg-brand-gray-light text-brand-gray-urban"
          }`}
        >
          📉 {score.pressure.toFixed(0)}hPa {TREND_ICON[pressureTrend]}
          <InfoButton title={METRIC_INFO.pressure.title} description={METRIC_INFO.pressure.description} />
        </span>
      </div>
      {pressureTrend === "falling" && (
        <p className="mt-2 rounded-lg bg-brand-yellow-warn/10 px-3 py-2 text-xs text-brand-yellow-warn">
          Frente de chuva se aproximando
        </p>
      )}
    </div>
  );
}
