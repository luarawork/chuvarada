// Abaixo de MIN_AMOSTRA_CONFIRMACAO relatos, a % de confirmação vira ruído
// estatístico (ex: 1 relato com 1 confirmação já mostra "100%") -- o card
// em app/analise/page.tsx mostra "—" em vez de uma taxa enganosamente
// precisa. Extraído de page.tsx pra lib/ só pra poder ser testado sem
// depender do componente React.
export const MIN_AMOSTRA_CONFIRMACAO = 5;

export function formatTaxaConfirmacao(
  taxaMediaConfirmacao: number | null,
  relatosComReacao: number
): string {
  if (taxaMediaConfirmacao == null || relatosComReacao < MIN_AMOSTRA_CONFIRMACAO) return "—";
  return `${taxaMediaConfirmacao}%`;
}
