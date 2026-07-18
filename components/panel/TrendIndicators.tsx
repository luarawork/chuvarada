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
        <span className="rounded-full bg-brand-gray-light px-3 py-1 text-xs text-brand-gray-urban">
          💨 {score.wind_speed.toFixed(0)}km/h
        </span>
        <span className="rounded-full bg-brand-gray-light px-3 py-1 text-xs text-brand-gray-urban">
          💧 {score.humidity.toFixed(0)}%
        </span>
        <span
          className={`rounded-full px-3 py-1 text-xs ${
            pressureTrend === "falling"
              ? "bg-brand-yellow-warn/20 text-brand-yellow-warn"
              : "bg-brand-gray-light text-brand-gray-urban"
          }`}
        >
          📉 {score.pressure.toFixed(0)}hPa {TREND_ICON[pressureTrend]}
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
