import type { RiskLevel } from "@/types";

// Constantes compartilhadas entre mais de um módulo de lib/. Antes duplicada
// (mesmo nome, mesmo valor) em lib/merge.ts e lib/weather.ts.
//
// Acima disso, o dado do MERGE/CPTEC em merge_cache é considerado velho
// demais pra representar "agora" -- lib/merge.ts usa isso pra decidir se
// devolve o dado ou null (cai pro fallback da Open-Meteo); lib/weather.ts
// checa de novo como defesa, não por confiança cega no que getMergeData já
// filtrou.
export const MERGE_MAX_AGE_HOURS = 6;

// Limiares do modelo de risco (ver lib/score.ts) -- rescala 2026-08-09
// (0-1/3 níveis -> 1-10/5 níveis, ver migração 042) pra dar granularidade
// entre "atenção" e "crítico", que antes cobria uma faixa larga demais
// (0.3-0.6 = tudo "atenção"). Fonte única: o gráfico de histórico
// (components/panel/ScoreHistory.tsx) e o painel /analise leem esses
// valores em vez de soltar números no JSX (ver comentário antigo abaixo,
// pré-rescala, sobre o motivo de centralizar).
export const SCORE_THRESHOLDS = {
  ATTENTION: 3.0,
  MODERATE: 5.0,
  HIGH: 6.5,
  CRITICAL: 8.0,
} as const;

// Cores de risco -- fonte única pro mapa (lib/geojson.ts), gráfico de
// histórico, legenda, alerta e demais telas que mostram nível de risco.
// Antes duplicado como hex literal em pelo menos 6 arquivos (ver
// docs/reports/revisao_qualidade.md, achado 🟡 #4).
//
// attention/moderate ajustados em 2026-08-09 (Opção C, maior contraste):
// o amarelo antigo de attention (#f0a500) e o laranja antigo de moderate
// (#f07800) ficavam próximos demais lado a lado no mapa/legenda -- difícil
// distinguir os dois níveis num relance. #ffe066 (amarelo pastel) e
// #d95f02 (laranja terra escuro) abrem mais a distância perceptual entre
// os dois mantendo a ordem clara normal->crítico.
export const RISK_COLORS: Record<RiskLevel, string> = {
  normal: "#2a9d72",
  attention: "#ffe066",
  moderate: "#d95f02",
  high: "#d64045",
  critical: "#7b2d8b",
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  normal: "Normal",
  attention: "Atenção",
  moderate: "Moderado",
  high: "Alto",
  critical: "Crítico",
};

// Deriva o level a partir do score numérico (escala 1-10) + auto_critical --
// mesma regra de lib/score.ts's calculateScore(): auto_critical sempre
// vence, senão pura comparação contra os limiares acima, do mais severo pro
// menos severo. Centralizado aqui pra o frontend poder recalcular o mesmo
// level do backend sem duplicar os números.
export function getLevelFromScore(score: number, autoCritical = false): RiskLevel {
  if (autoCritical || score >= SCORE_THRESHOLDS.CRITICAL) return "critical";
  if (score >= SCORE_THRESHOLDS.HIGH) return "high";
  if (score >= SCORE_THRESHOLDS.MODERATE) return "moderate";
  if (score >= SCORE_THRESHOLDS.ATTENTION) return "attention";
  return "normal";
}

export function getRiskColor(level: RiskLevel): string {
  return RISK_COLORS[level];
}

// Emoji/classe de texto por nível -- antes duplicado (mesmo valor) em
// ForecastStrip.tsx, ForecastPanel.tsx e RiskBadge.tsx (redesign do
// DetailPanel, ver components/panel/). moderate/high usam os 2 novos tokens
// de brand color (tailwind.config.ts) -- yellow-warn/red-alert já estavam
// ocupados por attention/high respectivamente antes da rescala.
export const LEVEL_EMOJI: Record<RiskLevel, string> = {
  normal: "🟢",
  attention: "🟡",
  moderate: "🟠",
  high: "🔴",
  critical: "🟣",
};
export const LEVEL_TEXT_CLASS: Record<RiskLevel, string> = {
  normal: "text-brand-green-water",
  attention: "text-brand-yellow-warn",
  moderate: "text-brand-orange-alert",
  high: "text-brand-red-alert",
  critical: "text-brand-purple-critical",
};

// Camadas de tile do mapa (ver components/map/MapContainer.tsx e
// components/map/LayerSwitcher.tsx). "default" (Modo Escuro) e "street"
// (Modo Claro, Voyager) -- o claro existe só pra dar contexto de rua/
// referência ao marcar um relato, onde o tema escuro dificulta reconhecer
// a própria localização.
//
// Tile escuro trocado 3x em 2026-08-09: CartoDB dark_all -> Esri
// World_Dark_Gray_Base (ruas mais nítidas, mas Esri pesou demais no
// carregamento) -> de volta pra CartoDB dark_all (mesmo CDN do Voyager
// abaixo, carregamento rápido e consistente; dark_all já inclui ruas/
// labels, ao contrário de dark_nolabels).
export const TILE_LAYERS = {
  default: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    label: "Modo Escuro",
    icon: "🌧️",
  },
  street: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    label: "Modo Claro",
    icon: "🗺️",
  },
} as const;

export type TileLayerKey = keyof typeof TILE_LAYERS;
