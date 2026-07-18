import type { RiskScore } from "@/types";

interface Row {
  emoji: string;
  label: string;
  valueLabel: string;
  normalized: number;
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
      emoji: "🌧",
      label: "Intensidade da chuva",
      valueLabel: `${score.rain_intensity.toFixed(1)}mm/h`,
      normalized: rainIntensityNorm,
    },
    {
      emoji: "🌧",
      label: "Chuva última hora",
      valueLabel: `${score.rain_1h.toFixed(1)}mm`,
      normalized: rain1hNorm,
    },
    {
      emoji: "🌧",
      label: "Chuva 72h",
      valueLabel: `${score.rain_72h.toFixed(1)}mm`,
      normalized: rain72hNorm,
    },
    {
      emoji: "⛰",
      label: `Terreno (${terrainLabel(score.terrain_slope)})`,
      valueLabel: "",
      normalized: score.terrain_slope,
    },
    {
      emoji: "🏞",
      label: "Proximidade hídrica",
      valueLabel: "",
      normalized: score.hydro_proximity,
    },
    {
      emoji: "🌊",
      label: "Maré",
      valueLabel: `${(score.tide_level * 100).toFixed(0)}%`,
      normalized: score.tide_level,
    },
  ];

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="flex items-center justify-between text-sm text-brand-gray-urban">
            <span>
              {row.emoji} {row.label}
              {row.valueLabel && <span className="ml-1 text-brand-gray-urban/60">{row.valueLabel}</span>}
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
