import { describe, it, expect } from "vitest";
import { getAlignment, ALIGNMENT_INFO } from "@/lib/reportAlignment";

// getAlignment não mora em app/analise/utils (esse arquivo não existe) --
// era uma função interna de app/analise/page.tsx, extraída pra lib/
// nesta rodada (páginas do App Router só podem exportar os campos
// reconhecidos por next -- generateMetadata etc. -- não funções soltas).
describe("getAlignment", () => {
  it("Normal + Leve diverge levemente (relato existe, modelo dizia normal)", () => {
    const result = ALIGNMENT_INFO[getAlignment("normal", "leve")];
    expect(result.label).toContain("levemente");
  });

  it("Normal + Grave diverge muito", () => {
    const result = ALIGNMENT_INFO[getAlignment("normal", "grave")];
    expect(result.label).toContain("muito");
  });

  it("Attention + Leve alinha", () => {
    const result = ALIGNMENT_INFO[getAlignment("attention", "leve")];
    expect(result.icon).toBe("✅");
  });

  it("Critical + Moderado alinha", () => {
    const result = ALIGNMENT_INFO[getAlignment("critical", "moderado")];
    expect(result.icon).toBe("✅");
  });

  it("Critical + Leve indica modelo mais conservador que o relato", () => {
    const result = ALIGNMENT_INFO[getAlignment("critical", "leve")];
    expect(result.label).toContain("conservador");
  });

  // ACHADO (não corrigido nesta rodada -- ver relatório final): o comentário
  // acima de getAlignment em app/analise/page.tsx afirma que "só Crítico+Grave
  // (as duas escalas no topo) dá diff=0", ou seja, essa combinação deveria
  // ALINHAR. Na prática REPORT_SCORE.grave=3 e LEVEL_ORDER.critical=2, então
  // diff=1, não 0 -- quem alinha de verdade é Attention+Leve e
  // Critical+Moderado (testes acima). Este teste documenta o comportamento
  // REAL hoje, não o pretendido pelo comentário -- é um teste de regressão,
  // não uma validação de que o design está correto.
  it("Critical + Grave hoje diverge levemente (não alinha, apesar do comentário dizer que deveria)", () => {
    const result = ALIGNMENT_INFO[getAlignment("critical", "grave")];
    expect(result.label).toContain("levemente");
  });
});
