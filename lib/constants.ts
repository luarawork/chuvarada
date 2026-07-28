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

// Limiares do modelo de risco (ver lib/score.ts) -- recalibrados em
// 2026-07-20 (diagnóstico do evento de Recife, ver comentário em
// lib/score.ts). Fonte única: antes desses valores existirem só aqui, o
// gráfico de histórico (components/panel/HistoryChart.tsx) e o painel
// /analise desenhavam as mesmas faixas com 0.3/0.6 soltos no JSX --
// funcionava só porque ninguém tinha mudado um lado sem lembrar do outro.
export const SCORE_THRESHOLDS = {
  ATTENTION: 0.3,
  CRITICAL: 0.6,
} as const;

// Cores de risco -- fonte única pro mapa (lib/geojson.ts), gráfico de
// histórico, legenda, alerta e demais telas que mostram nível de risco.
// Antes duplicado como hex literal em pelo menos 6 arquivos (ver
// docs/revisao_qualidade.md, achado 🟡 #4).
export const RISK_COLORS: Record<RiskLevel, string> = {
  normal: "#2a9d72",
  attention: "#f0a500",
  critical: "#d64045",
};

// Deriva o level a partir do score numérico + auto_critical -- mesma regra
// de lib/score.ts's calculateScore(): auto_critical sempre vence, senão pura
// comparação contra os limiares acima. Centralizado aqui pra o frontend
// poder recalcular o mesmo level do backend sem duplicar os números.
export function getLevelFromScore(score: number, autoCritical = false): RiskLevel {
  if (autoCritical || score >= SCORE_THRESHOLDS.CRITICAL) return "critical";
  if (score >= SCORE_THRESHOLDS.ATTENTION) return "attention";
  return "normal";
}

export function getRiskColor(level: RiskLevel): string {
  return RISK_COLORS[level];
}

// Camadas de tile do mapa (ver components/map/MapContainer.tsx e
// components/map/LayerSwitcher.tsx). "default" é o Dark Matter original,
// mantido pra manter a identidade visual escura do app; "street" (Voyager)
// existe só pra dar contexto de rua/referência ao marcar um relato, onde o
// tema escuro dificulta reconhecer a própria localização.
export const TILE_LAYERS = {
  default: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    label: "Modo Padrão",
    icon: "🌧️",
  },
  street: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    label: "Modo Rua",
    icon: "🗺️",
  },
} as const;

export type TileLayerKey = keyof typeof TILE_LAYERS;
