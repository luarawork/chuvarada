"use client";

import { TILE_LAYERS, type TileLayerKey } from "@/lib/constants";

interface LayerSwitcherProps {
  currentLayer: TileLayerKey;
  onChange: (layer: TileLayerKey) => void;
}

// Mostra sempre o modo OPOSTO ao atual -- indica pra onde o clique leva, não
// o estado atual (mesma convenção de um toggle de tema claro/escuro).
export function LayerSwitcher({ currentLayer, onChange }: LayerSwitcherProps) {
  const nextLayer: TileLayerKey = currentLayer === "default" ? "street" : "default";
  const next = TILE_LAYERS[nextLayer];

  // top-16 (64px), não top-14 (56px) -- o ProfileButton (h-11, top-4) já
  // ocupa até 60px de altura; 56px sobrepunha 4px o próprio botão de login
  // (confirmado medindo os dois num viewport mobile de 375px).
  return (
    <button
      onClick={() => onChange(nextLayer)}
      aria-label={`Mudar para ${next.label}`}
      className="pointer-events-auto absolute right-4 top-16 z-[1000] rounded-lg border border-brand-blue-mid/30 px-3 py-2 text-[13px] text-brand-gray-light shadow-lg backdrop-blur transition-colors duration-200 hover:border-brand-blue-mid/60"
      style={{ backgroundColor: "rgba(13, 27, 42, 0.92)" }}
    >
      {next.icon} {next.label}
    </button>
  );
}
