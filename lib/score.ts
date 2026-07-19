import type { Neighborhood, NormalizedWeather, RiskLevel, ScoreResult } from "@/types";

const WEIGHTS = {
  rain_intensity: 0.25,
  rain_1h: 0.2,
  rain_72h: 0.2,
  terrain_slope: 0.15,
  hydro_proximity: 0.12,
  tide_level: 0.08,
};

// Municípios sem estação de maré nas proximidades (city.tide_code null) não
// entram no cálculo com um "meio-termo" de 0.5 fingindo neutralidade — isso
// distorceria o score pra mais ou pra menos sem nenhum dado real por trás.
// Em vez disso, o peso de 8% da maré é redistribuído proporcionalmente entre
// as demais variáveis, mantendo a soma em 1.0.
const WEIGHT_WITHOUT_TIDE = (() => {
  const remaining = 1 - WEIGHTS.tide_level;
  return {
    rain_intensity: WEIGHTS.rain_intensity / remaining,
    rain_1h: WEIGHTS.rain_1h / remaining,
    rain_72h: WEIGHTS.rain_72h / remaining,
    terrain_slope: WEIGHTS.terrain_slope / remaining,
    hydro_proximity: WEIGHTS.hydro_proximity / remaining,
  };
})();

function normalizeLinear(value: number, mid: number, max: number): number {
  if (value <= 0) return 0;
  if (value >= max) return 1;
  // interpola linearmente usando o ponto médio como referência de 0.5
  if (value <= mid) return (value / mid) * 0.5;
  return 0.5 + ((value - mid) / (max - mid)) * 0.5;
}

function levelFromScore(score: number): RiskLevel {
  if (score < 0.4) return "normal";
  if (score < 0.7) return "attention";
  return "critical";
}

export function calculateScore(
  neighborhood: Pick<Neighborhood, "terrain_slope" | "hydro_proximity" | "is_coastal">,
  weather: NormalizedWeather,
  tideLevel: number | null
): ScoreResult {
  const hasTide = tideLevel !== null;
  const weights = hasTide ? WEIGHTS : WEIGHT_WITHOUT_TIDE;

  const breakdown = {
    rain_intensity: normalizeLinear(weather.rain_intensity, 10, 30),
    rain_1h: normalizeLinear(weather.rain_1h, 25, 50),
    rain_72h: normalizeLinear(weather.rain_72h, 50, 100),
    terrain_slope: neighborhood.terrain_slope,
    hydro_proximity: neighborhood.hydro_proximity,
    tide_level: tideLevel ?? 0,
  };

  let score =
    breakdown.rain_intensity * weights.rain_intensity +
    breakdown.rain_1h * weights.rain_1h +
    breakdown.rain_72h * weights.rain_72h +
    breakdown.terrain_slope * weights.terrain_slope +
    breakdown.hydro_proximity * weights.hydro_proximity;

  if (hasTide) score += breakdown.tide_level * WEIGHTS.tide_level;

  let level = levelFromScore(score);
  let autoCritical = false;
  let autoCriticalReason: string | null = null;

  if (weather.rain_1h > 50) {
    autoCritical = true;
    autoCriticalReason = "Chuva extrema na última hora";
  } else if (hasTide && tideLevel > 0.8 && weather.rain_3h > 20 && neighborhood.is_coastal) {
    autoCritical = true;
    autoCriticalReason = "Maré alta com chuva em zona costeira";
  } else if (weather.rain_72h > 100 && weather.rain_1h > 0) {
    autoCritical = true;
    autoCriticalReason = "Solo saturado com nova precipitação";
  }

  if (autoCritical) level = "critical";

  return {
    score: Math.min(1, Math.max(0, score)),
    level,
    auto_critical: autoCritical,
    auto_critical_reason: autoCriticalReason,
    breakdown,
  };
}
