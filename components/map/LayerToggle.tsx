"use client";

import { TILE_LAYERS, type TileLayerKey } from "@/lib/constants";

interface LayerToggleProps {
  currentLayer: TileLayerKey;
  onChange: (layer: TileLayerKey) => void;
}

const ORDER: TileLayerKey[] = ["default", "street"];
const SHORT_LABELS: Record<TileLayerKey, string> = { default: "Escuro", street: "Claro" };

// Segmented control com pill deslizante -- substitui o antigo botão único
// LayerSwitcher (que alternava mostrando só um modo por vez). Aqui os dois
// modos ficam sempre visíveis lado a lado, então não existe mais a
// ambiguidade "o texto mostra o atual ou o destino?" que gerou confusão
// antes -- cada label sempre descreve a si mesma, e o pill deslizante marca
// qual está ativa.
export function LayerToggle({ currentLayer, onChange }: LayerToggleProps) {
  return (
    <div
      className="pointer-events-auto relative flex h-9 w-40 items-center rounded-full border p-0.5 shadow-lg backdrop-blur"
      style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
    >
      <div
        className="absolute left-0.5 top-0.5 h-[30px] w-[78px] rounded-full bg-brand-blue-mid transition-transform duration-200 ease-out"
        style={{ transform: currentLayer === "street" ? "translateX(78px)" : "translateX(0)" }}
      />
      {ORDER.map((key) => {
        const layer = TILE_LAYERS[key];
        const active = currentLayer === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            aria-pressed={active}
            className={`relative z-10 flex h-8 flex-1 items-center justify-center gap-1 text-[13px] transition-colors before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] ${
              active ? "font-semibold text-white" : "font-normal text-brand-blue-light"
            }`}
          >
            {layer.icon} {SHORT_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
