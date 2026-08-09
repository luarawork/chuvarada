"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TILE_LAYERS, type TileLayerKey } from "@/lib/constants";

interface LayerToggleProps {
  currentLayer: TileLayerKey;
  onChange: (layer: TileLayerKey) => void;
}

const ORDER: TileLayerKey[] = ["default", "street"];
const SHORT_LABELS: Record<TileLayerKey, string> = { default: "Escuro", street: "Claro" };

// Segmented control com pill deslizante -- Radix ToggleGroup (via shadcn)
// cuida de estado/acessibilidade (type="single", roving focus, aria), mas
// NÃO tem indicador deslizante embutido -- o pill continua sendo a mesma
// div absoluta de antes, só que agora dentro do ToggleGroup em vez de um
// <div> cru. h-[30px]/rounded-full/top-0.5/left-0.5 NÃO PODEM mudar: gap
// 3px/3px medido em produção (chuvarada.vercel.app) antes desta migração
// -- ver commit 60e471e -- qualquer ajuste aqui reintroduziria a assimetria
// 3px/1px que foi corrigida.
export function LayerToggle({ currentLayer, onChange }: LayerToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={currentLayer}
      onValueChange={(value) => {
        if (value) onChange(value as TileLayerKey);
      }}
      className="pointer-events-auto relative h-9 w-40 items-center justify-start rounded-full border p-0.5 shadow-lg backdrop-blur"
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
          <ToggleGroupItem
            key={key}
            value={key}
            aria-pressed={active}
            className={`relative z-10 flex h-8 flex-1 items-center justify-center gap-1 rounded-none bg-transparent text-[13px] transition-colors hover:bg-transparent data-[state=on]:bg-transparent ${
              active ? "font-semibold text-white" : "font-normal text-brand-blue-light"
            }`}
          >
            {layer.icon} {SHORT_LABELS[key]}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
