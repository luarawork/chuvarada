import type { ReactNode } from "react";
import { InfoButton } from "@/components/ui/InfoButton";
import { RainIcon, WaveIcon } from "@/components/ui/WeatherIcons";
import { METRIC_INFO, type MetricInfoKey } from "@/lib/metricInfo";
import type { RiskScore } from "@/types";

interface Row {
  icon: ReactNode;
  label: string;
  valueLabel: string;
  normalized: number;
  infoKey: MetricInfoKey;
}

function terrainLabel(slope: number): string {
  if (slope > 0.7) return "Área baixa";
  if (slope > 0.4) return "Área moderada";
  return "Área elevada";
}

interface ScoreBreakdownProps {
  score: RiskScore;
}

export function ScoreBreakdown({ score }: ScoreBreakdownProps) {
  const rainIntensityNorm = Math.min(1, score.rain_intensity / 30);
  const rain1hNorm = Math.min(1, score.rain_1h / 50);
  const rain72hNorm = Math.min(1, score.rain_72h / 100);

  const rows: Row[] = [
    {
      icon: <RainIcon />,
      label: "Intensidade da chuva",
      valueLabel: `${score.rain_intensity.toFixed(1)}mm/h`,
      normalized: rainIntensityNorm,
      infoKey: "rainIntensity",
    },
    {
      icon: <RainIcon />,
      label: "Chuva última hora",
      valueLabel: `${score.rain_1h.toFixed(1)}mm`,
      normalized: rain1hNorm,
      infoKey: "rain1h",
    },
    {
      icon: <RainIcon />,
      label: "Chuva 72h",
      valueLabel: `${score.rain_72h.toFixed(1)}mm`,
      normalized: rain72hNorm,
      infoKey: "rain72h",
    },
    {
      icon: <span className="text-sm">⛰</span>,
      label: `Terreno (${terrainLabel(score.terrain_slope)})`,
      valueLabel: "",
      normalized: score.terrain_slope,
      infoKey: "terrain",
    },
    {
      icon: <span className="text-sm">🏞</span>,
      label: "Proximidade hídrica",
      valueLabel: "",
      normalized: score.hydro_proximity,
      infoKey: "hydroProximity",
    },
    {
      icon: <WaveIcon />,
      label: "Maré",
      valueLabel: `${(score.tide_level * 100).toFixed(0)}%`,
      normalized: score.tide_level,
      infoKey: "tide",
    },
  ];

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="flex items-center justify-between text-sm text-brand-gray-urban">
            <span className="flex items-center gap-1.5">
              {row.icon} {row.label}
              {row.valueLabel && <span className="text-brand-gray-urban/60">{row.valueLabel}</span>}
              <InfoButton
                title={METRIC_INFO[row.infoKey].title}
                description={METRIC_INFO[row.infoKey].description}
              />
            </span>
            <span className="text-xs text-brand-gray-urban/60">{row.normalized.toFixed(2)}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-brand-gray-light">
            <div
              className="h-full rounded-full bg-brand-blue-mid"
              style={{ width: `${row.normalized * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
