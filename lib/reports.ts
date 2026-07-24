export type ReportSeverity = "leve" | "moderado" | "grave";

// Duração base por gravidade, em minutos.
const BASE_DURATION_MINUTES: Record<ReportSeverity, number> = {
  leve: 30,
  moderado: 90,
  grave: 180,
};

// Cada confirmação da comunidade estende a expiração em 15min, até um teto
// de 2h extra -- evita que um relato fique "vivo" indefinidamente só por
// acumular confirmações, mas ainda recompensa relatos validados por várias
// pessoas com mais tempo de vida no mapa.
const MINUTES_PER_CONFIRMATION = 15;
const MAX_CONFIRMATION_BONUS_MINUTES = 120;

export function calculateExpiresAt(severity: ReportSeverity, confirmations: number): Date {
  const bonus = Math.min(confirmations * MINUTES_PER_CONFIRMATION, MAX_CONFIRMATION_BONUS_MINUTES);
  const totalMinutes = BASE_DURATION_MINUTES[severity] + bonus;
  return new Date(Date.now() + totalMinutes * 60_000);
}

// Peso do relato pro cruzamento futuro com o score do modelo -- relatos
// autenticados pesam mais que anônimos, e confirmações líquidas da
// comunidade (confirmações - negações) aumentam o peso, até um teto de 2x.
const ANONYMOUS_WEIGHT = 0.5;
const AUTHENTICATED_WEIGHT = 1.0;
const CONFIRMATION_WEIGHT_STEP = 0.1;
const MAX_WEIGHT = 2.0;

export function calculateReportWeight(isAnonymous: boolean, confirmations: number, denials: number): number {
  const baseWeight = isAnonymous ? ANONYMOUS_WEIGHT : AUTHENTICATED_WEIGHT;
  const netConfirmations = Math.max(0, confirmations - denials);
  return Math.min(baseWeight + netConfirmations * CONFIRMATION_WEIGHT_STEP, MAX_WEIGHT);
}
