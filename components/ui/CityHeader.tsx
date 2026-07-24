"use client";

import { RiskBadge } from "./RiskBadge";
import type { RiskLevel } from "@/types";

interface CityHeaderProps {
  cityName: string | null;
  level: RiskLevel;
  updatedAt: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "sem dados ainda";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Atualizado agora";
  if (minutes === 1) return "Atualizado há 1 minuto";
  if (minutes < 60) return `Atualizado há ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  return `Atualizado há ${hours}h`;
}

// Sem posicionamento próprio -- renderizado dentro da pilha flex-col do
// canto superior esquerdo (junto com MapLegend), ver app/page.tsx.
export function CityHeader({ cityName, level, updatedAt }: CityHeaderProps) {
  return (
    <div
      className="pointer-events-auto rounded-xl border px-4 py-3 shadow-lg backdrop-blur"
      style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
    >
      <div className="flex items-center gap-2">
        <h1 className="font-heading text-lg font-bold" style={{ color: "#f0f4f8" }}>
          {cityName ?? "Brasil"}
        </h1>
        <RiskBadge level={level} />
      </div>
      <p className="mt-0.5 text-xs" style={{ color: "#a8d4f0" }}>
        {timeAgo(updatedAt)}
      </p>
    </div>
  );
}
