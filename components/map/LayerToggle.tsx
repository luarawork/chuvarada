"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TILE_LAYERS, type TileLayerKey } from "@/lib/constants";

interface LayerToggleProps {
  currentLayer: TileLayerKey;
  onChange: (layer: TileLayerKey) => void;
}

const ORDER: TileLayerKey[] = ["default", "street"];

// Versão só-ícone (correção de UI pós-migração shadcn) -- cada item agora
// tem 36px (era ~78px com o texto "Escuro"/"Claro"), então a geometria do
// pill deslizante foi recalculada do zero pra essa largura nova: container
// 76px (2 items × 36px + 2px de padding em cada lado), pill 36px, desloca
// exatamente 1 item de largura (translateX(36px)) quando "street" tá ativo.
// Contexto de por que o texto saiu: o toggle virou um segundo elemento
// dentro da pilha vertical abaixo do ProfileButton (ver app/page.tsx),
// que é um círculo de ~36-40px -- com texto ele ficava desproporcionalmente
// largo ao lado de um ícone circular tão compacto.
export function LayerToggle({ currentLayer, onChange }: LayerToggleProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <ToggleGroup
        type="single"
        value={currentLayer}
        onValueChange={(value) => {
          if (value) onChange(value as TileLayerKey);
        }}
        className="pointer-events-auto relative h-9 w-[76px] items-center justify-start rounded-full border p-0.5 shadow-lg backdrop-blur"
        style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
      >
        <div
          className="absolute left-0.5 top-0.5 h-8 w-9 rounded-full bg-brand-blue-mid transition-transform duration-200 ease-out"
          style={{ transform: currentLayer === "street" ? "translateX(36px)" : "translateX(0)" }}
        />
        {ORDER.map((key) => {
          const layer = TILE_LAYERS[key];
          const active = currentLayer === key;
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <ToggleGroupItem
                  value={key}
                  aria-label={layer.label}
                  aria-pressed={active}
                  className="relative z-10 flex h-8 w-9 items-center justify-center rounded-full bg-transparent text-base transition-colors hover:bg-transparent data-[state=on]:bg-transparent"
                >
                  {layer.icon}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent side="left">{layer.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </ToggleGroup>
    </TooltipProvider>
  );
}
