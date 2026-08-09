import { Badge } from "@/components/ui/badge";
import type { RiskLevel } from "@/types";

const LEVEL_CONFIG: Record<RiskLevel, { emoji: string; label: string; bg: string; text: string }> = {
  normal: { emoji: "🟢", label: "Normal", bg: "bg-brand-green-water/15", text: "text-brand-green-water" },
  attention: { emoji: "🟡", label: "Atenção", bg: "bg-brand-yellow-warn/15", text: "text-brand-yellow-warn" },
  moderate: { emoji: "🟠", label: "Moderado", bg: "bg-brand-orange-alert/15", text: "text-brand-orange-alert" },
  high: { emoji: "🔴", label: "Alto", bg: "bg-brand-red-alert/15", text: "text-brand-red-alert" },
  critical: { emoji: "🟣", label: "Crítico", bg: "bg-brand-purple-critical/15", text: "text-brand-purple-critical" },
};

interface RiskBadgeProps {
  level: RiskLevel;
  score?: number;
  className?: string;
}

// variant="outline" no Badge do shadcn deixa cor 100% por conta do
// className (ver components/ui/badge.tsx) -- é o que os 5 níveis de risco
// precisam, já que a cor é semântica (RISK_COLORS/brand tokens), não uma
// das 5 cores fixas do design system do shadcn.
export function RiskBadge({ level, score, className = "" }: RiskBadgeProps) {
  const config = LEVEL_CONFIG[level];
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 border-none px-3 py-1 text-sm font-medium ${config.bg} ${config.text} ${className}`}
    >
      <span>{config.emoji}</span>
      <span>{config.label}</span>
      {typeof score === "number" && <span className="opacity-70">· {score.toFixed(2)}</span>}
    </Badge>
  );
}

export function riskLevelLabel(level: RiskLevel): string {
  return LEVEL_CONFIG[level].label;
}
