import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { RISK_COLORS } from "@/lib/constants";
import type { DeviationResult } from "@/lib/climatology";
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
  centroid: { lat: number; lng: number } | null;
}

export function RiskFactors({ score, hasTideStation, centroid }: RiskFactorsProps) {
  // Desvio da média histórica -- busca só quando tem centroide (sempre que
  // neighborhood existe, ver DetailPanel) e rain_72h do score atual.
  // Silenciosamente ignorado se a API falhar (dado histórico é contexto
  // complementar, não pode travar o painel de bairro).
  const [deviation, setDeviation] = useState<DeviationResult | null>(null);

  useEffect(() => {
    setDeviation(null);
    if (!centroid) return;

    const controller = new AbortController();
    fetch(`/api/climatology?lat=${centroid.lat}&lng=${centroid.lng}&rain72h=${score.rain_72h}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DeviationResult | null) => {
        if (data && "deviation_pct" in data) setDeviation(data);
      })
      .catch(() => null);

    return () => controller.abort();
  }, [centroid, score.rain_72h]);

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
      icon: "🌱",
      label: "Umidade do solo",
      valueLabel: `${(score.soil_moisture * 100).toFixed(0)}%`,
      normalized: score.soil_moisture,
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
        {rows.map((row, i) => (
          <div key={row.label}>
            {i > 0 && <Separator className="mb-2 opacity-15" />}
            <div className="grid grid-cols-[1fr_auto_minmax(48px,1fr)_28px] items-center gap-2">
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
            {/* Desvio histórico só embaixo de Chuva 72h -- é a variável que a
                climatologia contextualiza (média histórica do mesmo período
                do ano). Só mostra quando o desvio for >=10% em módulo --
                abaixo disso não tem significado prático pro cidadão. */}
            {row.label === "Chuva 72h" && deviation && Math.abs(deviation.deviation_pct) >= 10 && (
              <p
                className={`mt-1 text-[11px] ${
                  deviation.deviation_pct > 50
                    ? "text-brand-red-alert"
                    : deviation.deviation_pct > 0
                      ? "text-brand-yellow-warn"
                      : "text-brand-blue-light/70"
                }`}
              >
                {deviation.deviation_pct > 0 ? "↑" : "↓"} {deviation.label}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
