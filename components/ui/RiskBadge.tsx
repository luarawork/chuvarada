import type { RiskLevel } from "@/types";

const LEVEL_CONFIG: Record<RiskLevel, { emoji: string; label: string; bg: string; text: string }> = {
  normal: { emoji: "🟢", label: "Normal", bg: "bg-brand-green-water/15", text: "text-brand-green-water" },
  attention: { emoji: "🟡", label: "Atenção", bg: "bg-brand-yellow-warn/15", text: "text-brand-yellow-warn" },
  critical: { emoji: "🔴", label: "Crítico", bg: "bg-brand-red-alert/15", text: "text-brand-red-alert" },
};

interface RiskBadgeProps {
  level: RiskLevel;
  score?: number;
  className?: string;
}

export function RiskBadge({ level, score, className = "" }: RiskBadgeProps) {
  const config = LEVEL_CONFIG[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${config.bg} ${config.text} ${className}`}
    >
      <span>{config.emoji}</span>
      <span>{config.label}</span>
      {typeof score === "number" && <span className="opacity-70">· {score.toFixed(2)}</span>}
    </span>
  );
}

export function riskLevelLabel(level: RiskLevel): string {
  return LEVEL_CONFIG[level].label;
}
