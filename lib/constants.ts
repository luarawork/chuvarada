// Constantes compartilhadas entre mais de um módulo de lib/. Antes duplicada
// (mesmo nome, mesmo valor) em lib/merge.ts e lib/weather.ts.
//
// Acima disso, o dado do MERGE/CPTEC em merge_cache é considerado velho
// demais pra representar "agora" -- lib/merge.ts usa isso pra decidir se
// devolve o dado ou null (cai pro fallback da Open-Meteo); lib/weather.ts
// checa de novo como defesa, não por confiança cega no que getMergeData já
// filtrou.
export const MERGE_MAX_AGE_HOURS = 6;

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
