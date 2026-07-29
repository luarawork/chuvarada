import type { RiskLevel as ModelLevel, ReportSeverity } from "@/types";
import { RISK_COLORS } from "@/lib/constants";

// Substitui a lógica anterior (diff numérico entre 2 escalas deslocadas,
// ver git blame) por mapeamento explícito de par categoria-a-categoria --
// mais fácil de auditar visualmente (cada uma das 9 combinações possíveis
// está escrita por extenso aqui) e sem a inconsistência descoberta pelos
// testes de regressão: o cálculo antigo dizia (no comentário) que
// Crítico+Grave deveria "Alinhar", mas o diff numérico de fato produzia
// "Diverge levemente" -- quem alinhava de verdade era Attention+Leve e
// Critical+Moderado. Este mapeamento corrige isso: Crítico+Grave e
// Atenção+Moderado alinham; os demais pares refletem o grau de divergência
// pretendido originalmente.
export type AlignmentKind =
  | "aligns"
  | "diverges_slightly"
  | "diverges"
  | "diverges_much"
  | "model_conservative"
  | "false_alarm"
  | "no_reports";

export interface AlignmentResult {
  label: string;
  icon: string;
  color: string;
  kind: AlignmentKind;
}

const ALIGNMENT_MAP: Record<string, AlignmentResult> = {
  "normal-leve": { label: "Diverge levemente", icon: "⚠️", color: RISK_COLORS.attention, kind: "diverges_slightly" },
  "normal-moderado": { label: "Diverge", icon: "🔴", color: RISK_COLORS.critical, kind: "diverges" },
  "normal-grave": { label: "Diverge muito", icon: "🔴", color: RISK_COLORS.critical, kind: "diverges_much" },
  "attention-leve": { label: "Modelo conservador", icon: "🔵", color: "#a8d4f0", kind: "model_conservative" },
  "attention-moderado": { label: "Alinha", icon: "✅", color: RISK_COLORS.normal, kind: "aligns" },
  "attention-grave": { label: "Diverge levemente", icon: "⚠️", color: RISK_COLORS.attention, kind: "diverges_slightly" },
  "critical-leve": { label: "Possível falso alarme", icon: "🔵", color: "#a8d4f0", kind: "false_alarm" },
  "critical-moderado": { label: "Modelo conservador", icon: "🔵", color: "#a8d4f0", kind: "model_conservative" },
  "critical-grave": { label: "Alinha", icon: "✅", color: RISK_COLORS.normal, kind: "aligns" },
};

const UNDEFINED_RESULT: AlignmentResult = { label: "Indefinido", icon: "—", color: "#a8d4f0", kind: "no_reports" };

// Sentinela pra bucket sem nenhum relato -- não é um par modelo+gravidade
// (não existe "gravidade" quando não há relato nenhum), por isso fica fora
// de ALIGNMENT_MAP, no mesmo padrão do "no_reports" da versão anterior.
export const NO_REPORTS_RESULT: AlignmentResult = { label: "Sem relatos", icon: "🔵", color: "#a8d4f0", kind: "no_reports" };

export function getAlignment(modelLevel: ModelLevel, reportSeverity: ReportSeverity): AlignmentResult {
  const key = `${modelLevel}-${reportSeverity}`;
  return ALIGNMENT_MAP[key] ?? UNDEFINED_RESULT;
}
