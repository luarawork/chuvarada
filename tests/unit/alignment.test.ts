import { describe, it, expect } from "vitest";
import { getAlignment } from "@/lib/alignmentUtils";

// getAlignment não mora em app/analise/utils (esse arquivo não existe) --
// era uma função interna de app/analise/page.tsx, extraída pra
// lib/alignmentUtils.ts (páginas do App Router só podem exportar os campos
// reconhecidos por next -- generateMetadata etc. -- não funções soltas).
//
// Lógica reescrita nesta rodada: mapeamento explícito por par
// categoria-a-categoria em vez do diff numérico anterior, que tinha uma
// inconsistência real (ver docs/reports/ -- o comentário antigo dizia que
// Crítico+Grave deveria alinhar, mas o cálculo de fato produzia "diverge
// levemente"). Agora Crítico+Grave e Atenção+Moderado são os pares que
// alinham de verdade.
describe("getAlignment — nova lógica por par de categorias", () => {
  // Pares que alinham
  it("attention + moderado = Alinha", () => {
    expect(getAlignment("attention", "moderado").icon).toBe("✅");
  });

  it("critical + grave = Alinha", () => {
    expect(getAlignment("critical", "grave").icon).toBe("✅");
  });

  // Divergências
  it("normal + leve = Diverge levemente", () => {
    expect(getAlignment("normal", "leve").label).toContain("levemente");
  });

  it("normal + moderado = Diverge (sem qualificador)", () => {
    const result = getAlignment("normal", "moderado");
    expect(result.label).toBe("Diverge");
    expect(result.kind).toBe("diverges");
  });

  it("normal + grave = Diverge muito", () => {
    expect(getAlignment("normal", "grave").label).toContain("muito");
  });

  it("attention + grave = Diverge levemente", () => {
    expect(getAlignment("attention", "grave").label).toContain("levemente");
  });

  // Modelo conservador / falso alarme
  it("critical + leve = Possível falso alarme", () => {
    expect(getAlignment("critical", "leve").label).toContain("falso");
  });

  it("attention + leve = Modelo conservador", () => {
    expect(getAlignment("attention", "leve").label).toContain("conservador");
  });

  it("critical + moderado = Modelo conservador", () => {
    expect(getAlignment("critical", "moderado").label).toContain("conservador");
  });

  it("cobre todos os 9 pares modelo x gravidade sem cair no fallback 'Indefinido'", () => {
    const levels = ["normal", "attention", "critical"] as const;
    const severities = ["leve", "moderado", "grave"] as const;
    for (const level of levels) {
      for (const severity of severities) {
        expect(getAlignment(level, severity).label).not.toBe("Indefinido");
      }
    }
  });
});
