import type { RiskScore } from "@/types";

// Extraído de app/page.tsx -- páginas do App Router só podem exportar os
// campos reconhecidos (default, generateMetadata etc.), mesma restrição de
// app/api/*/route.ts (ver lib/riskScoring.ts). Precisou virar lib/ pra dar
// pra importar em tests/regression/critical-bugs.test.ts.
//
// Bairro pode ter score atualizado por 2 fontes concorrentes: o fetch do
// viewport (bbox) e o Supabase Realtime (INSERT em risk_scores). O fetch do
// viewport pode demorar (medido até ~5s num zoom-out grande) e resolver
// DEPOIS de um evento Realtime mais recente já ter chegado -- um merge cego
// (`{...prev, ...scores}`) deixaria o score antigo do fetch sobrescrever o
// score novo do Realtime, fazendo o polígono voltar a ficar verde mesmo com
// o painel (que busca direto por id, sem essa disputa) já mostrando
// crítico. Comparar calculated_at garante que a versão mais recente sempre
// vence, não importa qual fonte respondeu por último.
export function mergeNewerScores(
  prev: Record<string, RiskScore>,
  incoming: Record<string, RiskScore>
): Record<string, RiskScore> {
  const next = { ...prev };
  for (const [id, score] of Object.entries(incoming)) {
    const existing = next[id];
    if (!existing || new Date(score.calculated_at) >= new Date(existing.calculated_at)) {
      next[id] = score;
    }
  }
  return next;
}
