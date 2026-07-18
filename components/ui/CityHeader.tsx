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

export function CityHeader({ cityName, level, updatedAt }: CityHeaderProps) {
  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-[1000] rounded-2xl bg-brand-blue-deep/90 px-4 py-3 shadow-lg backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <h1 className="font-heading text-lg font-bold text-white">
          {cityName ?? "Nordeste"}
        </h1>
        <RiskBadge level={level} />
      </div>
      <p className="mt-0.5 text-xs text-brand-blue-light">{timeAgo(updatedAt)}</p>
    </div>
  );
}
