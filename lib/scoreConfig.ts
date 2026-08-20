// Pesos do modelo por região -- hoje todas as 5 regiões usam os mesmos
// valores (idênticos ao WEIGHTS original de lib/score.ts). Estrutura pronta
// pra calibração futura (ex: rain_72h maior no Sul, onde a chuva frontal
// tende a acumular mais do que a convectiva do Nordeste) -- ver Roadmap.
export type Region = "nordeste" | "sul" | "sudeste" | "centro-oeste" | "norte";

export const REGION_BY_STATE: Record<string, Region> = {
  // Nordeste
  AL: "nordeste", BA: "nordeste", CE: "nordeste", MA: "nordeste",
  PB: "nordeste", PE: "nordeste", PI: "nordeste", RN: "nordeste", SE: "nordeste",
  // Sul
  PR: "sul", SC: "sul", RS: "sul",
  // Sudeste
  ES: "sudeste", MG: "sudeste", RJ: "sudeste", SP: "sudeste",
  // Centro-Oeste
  DF: "centro-oeste", GO: "centro-oeste", MS: "centro-oeste", MT: "centro-oeste",
  // Norte
  AC: "norte", AM: "norte", AP: "norte", PA: "norte",
  RO: "norte", RR: "norte", TO: "norte",
};

export interface ScoreWeights {
  rain_peak_3h: number;
  rain_1h: number;
  rain_72h: number;
  terrain_slope: number;
  soil_moisture: number;
  hydro_proximity: number;
  tide_level: number;
}

// Pesos redistribuídos em 2026-08-19 pra abrir espaço pra soil_moisture
// (umidade do solo, Open-Meteo) -- reduzidos proporcionalmente mais das
// variáveis de chuva de curto prazo (rain_1h/rain_72h) e menos das
// estruturais (terrain_slope), já que soil_moisture é conceitualmente mais
// próxima de "quanta chuva nova o solo ainda absorve" do que de terreno/
// hidrografia. Ver docs/studies/variaveis-hidrologicas.md.
const DEFAULT_WEIGHTS: ScoreWeights = {
  rain_peak_3h: 0.22,
  rain_1h: 0.15,
  rain_72h: 0.16,
  terrain_slope: 0.14,
  soil_moisture: 0.14,
  hydro_proximity: 0.11,
  tide_level: 0.08,
};

// Por ora todos os pesos são iguais -- estrutura pronta para calibração futura.
export const SCORE_WEIGHTS_BY_REGION: Record<Region, ScoreWeights> = {
  nordeste: DEFAULT_WEIGHTS,
  sul: DEFAULT_WEIGHTS,
  sudeste: DEFAULT_WEIGHTS,
  "centro-oeste": DEFAULT_WEIGHTS,
  norte: DEFAULT_WEIGHTS,
};

export function getRegionByState(state: string): Region {
  return REGION_BY_STATE[state] ?? "nordeste";
}

export function getWeightsByState(state: string): ScoreWeights {
  return SCORE_WEIGHTS_BY_REGION[getRegionByState(state)];
}
