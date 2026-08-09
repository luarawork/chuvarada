import type { RiskLevel as ModelLevel, ReportSeverity } from "@/types";
import { RISK_COLORS } from "@/lib/constants";

// Substitui a lógica anterior (diff numérico entre 2 escalas deslocadas,
// ver git blame) por mapeamento explícito de par categoria-a-categoria --
// mais fácil de auditar visualmente (cada uma das 15 combinações possíveis,
// desde a rescala 2026-08-09 pra 5 níveis de modelo × 3 gravidades de
// relato, está escrita por extenso aqui).
//
// Nomes de kind (align/diverge_light/diverge/diverge_heavy/conservative/
// false_alarm) são os da rescala -- diferentes dos nomes usados na versão
// de 3 níveis (aligns/diverges_slightly/model_conservative etc.), então
// todo consumidor de AlignmentKind (ver app/analise/page.tsx,
// DIVERGENCE_SEVERITY_ORDER) precisou ser atualizado junto.
export type AlignmentKind =
  | "align"
  | "diverge_light"
  | "diverge"
  | "diverge_heavy"
  | "conservative"
  | "false_alarm"
  | "no_reports";

export interface AlignmentResult {
  label: string;
  icon: string;
  color: string;
  kind: AlignmentKind;
}

// Cores derivadas de RISK_COLORS pelo kind (não deram cor explícita no
// pedido original) -- diverge_light/diverge/diverge_heavy escalam
// visualmente com a mesma paleta de severidade do modelo (amarelo -> vermelho
// -> roxo); conservative/false_alarm usam o azul claro neutro já usado pra
// "sem informação forte" no resto do app.
const NEUTRAL_BLUE = "#a8d4f0";

const ALIGNMENT_MAP: Record<string, AlignmentResult> = {
  // Normal
  "normal-leve": { label: "Diverge levemente", icon: "⚠️", color: RISK_COLORS.attention, kind: "diverge_light" },
  "normal-moderado": { label: "Diverge", icon: "🔴", color: RISK_COLORS.high, kind: "diverge" },
  "normal-grave": { label: "Diverge muito", icon: "🔴", color: RISK_COLORS.critical, kind: "diverge_heavy" },
  // Atenção
  "attention-leve": { label: "Modelo conservador", icon: "🔵", color: NEUTRAL_BLUE, kind: "conservative" },
  "attention-moderado": { label: "Alinha", icon: "✅", color: RISK_COLORS.normal, kind: "align" },
  "attention-grave": { label: "Diverge levemente", icon: "⚠️", color: RISK_COLORS.attention, kind: "diverge_light" },
  // Moderado
  "moderate-leve": { label: "Modelo conservador", icon: "🔵", color: NEUTRAL_BLUE, kind: "conservative" },
  "moderate-moderado": { label: "Alinha", icon: "✅", color: RISK_COLORS.normal, kind: "align" },
  "moderate-grave": { label: "Alinha", icon: "✅", color: RISK_COLORS.normal, kind: "align" },
  // Alto
  "high-leve": { label: "Possível falso alarme", icon: "🔵", color: NEUTRAL_BLUE, kind: "false_alarm" },
  "high-moderado": { label: "Modelo conservador", icon: "🔵", color: NEUTRAL_BLUE, kind: "conservative" },
  "high-grave": { label: "Alinha", icon: "✅", color: RISK_COLORS.normal, kind: "align" },
  // Crítico
  "critical-leve": { label: "Possível falso alarme", icon: "🔵", color: NEUTRAL_BLUE, kind: "false_alarm" },
  "critical-moderado": { label: "Modelo conservador", icon: "🔵", color: NEUTRAL_BLUE, kind: "conservative" },
  "critical-grave": { label: "Alinha", icon: "✅", color: RISK_COLORS.normal, kind: "align" },
};

const UNDEFINED_RESULT: AlignmentResult = { label: "Indefinido", icon: "—", color: NEUTRAL_BLUE, kind: "no_reports" };

// Sentinela pra bucket sem nenhum relato -- não é um par modelo+gravidade
// (não existe "gravidade" quando não há relato nenhum), por isso fica fora
// de ALIGNMENT_MAP, no mesmo padrão do "no_reports" da versão anterior.
export const NO_REPORTS_RESULT: AlignmentResult = { label: "Sem relatos", icon: "🔵", color: NEUTRAL_BLUE, kind: "no_reports" };

export function getAlignment(modelLevel: ModelLevel, reportSeverity: ReportSeverity): AlignmentResult {
  const key = `${modelLevel}-${reportSeverity}`;
  return ALIGNMENT_MAP[key] ?? UNDEFINED_RESULT;
}
