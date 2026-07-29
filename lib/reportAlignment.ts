import type { ReportSeverity, RiskLevel } from "@/types";

// Extraído de app/analise/page.tsx -- páginas do App Router só podem
// exportar os campos reconhecidos (default, generateMetadata etc.), mesma
// restrição de app/api/*/route.ts (ver lib/riskScoring.ts). Precisou virar
// lib/ pra dar pra importar em tests/unit/alignment.test.ts.

// REPORT_SCORE começa em 1 (não 0 como SEVERITY_ORDER) -- um relato, mesmo
// "Leve", é sempre um evento real acontecendo, então nunca deveria "empatar"
// com o modelo em Normal (score 0) só por estarem ambos no índice mais
// baixo da própria escala. Com essa escala deslocada, diff = relato -
// modelo: Normal+Leve dá diff=+1 ("Diverge levemente", o modelo subestimou),
// e só Crítico+Grave (as duas escalas no topo) dá diff=0 ("Alinha").
const LEVEL_ORDER: Record<RiskLevel, number> = { normal: 0, attention: 1, critical: 2 };
const REPORT_SCORE: Record<ReportSeverity, number> = { leve: 1, moderado: 2, grave: 3 };

export type Alignment = "aligns" | "diverges_slightly" | "diverges_much" | "model_conservative" | "false_alarm" | "no_reports";

export function getAlignment(modelLevel: RiskLevel, reportSeverity: ReportSeverity): Alignment {
  const diff = REPORT_SCORE[reportSeverity] - LEVEL_ORDER[modelLevel];
  if (diff === 0) return "aligns";
  if (diff === 1) return "diverges_slightly";
  if (diff >= 2) return "diverges_much";
  if (diff === -1) return "model_conservative";
  return "false_alarm";
}

export const ALIGNMENT_INFO: Record<Alignment, { label: string; icon: string; color: string }> = {
  aligns: { label: "Alinha", icon: "✅", color: "#2a9d72" },
  diverges_slightly: { label: "Diverge levemente", icon: "⚠️", color: "#f0a500" },
  diverges_much: { label: "Diverge muito", icon: "🔴", color: "#d64045" },
  model_conservative: { label: "Modelo mais conservador", icon: "🔵", color: "#a8d4f0" },
  false_alarm: { label: "Possível falso alarme", icon: "🔵", color: "#a8d4f0" },
  no_reports: { label: "Sem relatos", icon: "🔵", color: "#a8d4f0" },
};
