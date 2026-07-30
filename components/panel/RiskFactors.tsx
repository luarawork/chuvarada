import { RISK_COLORS } from "@/lib/constants";
import type { RiskScore } from "@/types";

interface Row {
  icon: string;
  label: string;
  valueLabel: string;
  normalized: number;
}

function terrainLabel(slope: number): string {
  if (slope > 0.7) return "Área baixa";
  if (slope > 0.4) return "Área moderada";
  return "Área elevada";
}

interface RiskFactorsProps {
  score: RiskScore;
  hasTideStation: boolean;
}

export function RiskFactors({ score, hasTideStation }: RiskFactorsProps) {
  const rows: Row[] = [
    {
      icon: "🌧️",
      label: "Chuva 72h",
      valueLabel: `${score.rain_72h.toFixed(1)}mm`,
      normalized: Math.min(1, score.rain_72h / 100),
    },
    {
      icon: "⚡",
      label: "Pico 3h",
      valueLabel: `${score.rain_peak_3h.toFixed(1)}mm`,
      normalized: Math.min(1, score.rain_peak_3h / 30),
    },
    {
      icon: "💧",
      label: "Última hora",
      valueLabel: `${score.rain_1h.toFixed(1)}mm`,
      normalized: Math.min(1, score.rain_1h / 50),
    },
    {
      icon: "⛰️",
      label: "Terreno",
      valueLabel: terrainLabel(score.terrain_slope),
      normalized: score.terrain_slope,
    },
    {
      icon: "🌊",
      label: "Proximidade hídrica",
      valueLabel: "",
      normalized: score.hydro_proximity,
    },
    ...(hasTideStation
      ? [{ icon: "🌊", label: "Maré", valueLabel: "", normalized: score.tide_level }]
      : []),
  ];

  const levelColor = RISK_COLORS[score.level];

  return (
    <div data-testid="risk-factors">
      <h3 className="mb-2 text-sm font-medium text-brand-blue-light/80">Fatores de risco</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[1fr_auto_minmax(48px,1fr)_28px] items-center gap-2">
            <span className="truncate text-[13px] text-brand-blue-light">
              {row.icon} {row.label}
            </span>
            <span className="whitespace-nowrap text-[13px] text-brand-gray-light">{row.valueLabel}</span>
            <div className="h-[3px] overflow-hidden rounded-full bg-brand-blue-mid/15 md:h-1">
              <div
                className="h-full rounded-full"
                style={{ width: `${row.normalized * 100}%`, backgroundColor: levelColor }}
              />
            </div>
            <span className="text-right text-[11px] text-brand-blue-light/60">{row.normalized.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
