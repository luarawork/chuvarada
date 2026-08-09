import { describe, it, expect } from "vitest";
import { getAlignment } from "@/lib/alignmentUtils";

// getAlignment não mora em app/analise/utils (esse arquivo não existe) --
// era uma função interna de app/analise/page.tsx, extraída pra
// lib/alignmentUtils.ts (páginas do App Router só podem exportar os campos
// reconhecidos por next -- generateMetadata etc. -- não funções soltas).
//
// Rescala 2026-08-09 (0-1/3 níveis -> 1-10/5 níveis, ver migração 042):
// ALIGNMENT_MAP passou de 9 pares (normal/attention/critical x leve/
// moderado/grave) pra 15 (+ moderate/high). Nomes de kind também mudaram
// (aligns -> align, diverges -> diverge, model_conservative -> conservative
// etc.) -- ver comentário em lib/alignmentUtils.ts.
describe("getAlignment — 15 pares (5 níveis de modelo x 3 gravidades)", () => {
  // Pares que alinham
  it("attention + moderado = Alinha", () => {
    expect(getAlignment("attention", "moderado").icon).toBe("✅");
  });

  it("moderate + moderado = Alinha", () => {
    expect(getAlignment("moderate", "moderado").kind).toBe("align");
  });

  it("moderate + grave = Alinha", () => {
    expect(getAlignment("moderate", "grave").kind).toBe("align");
  });

  it("high + grave = Alinha", () => {
    expect(getAlignment("high", "grave").kind).toBe("align");
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
    expect(result.kind).toBe("diverge");
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

  it("high + leve = Possível falso alarme", () => {
    expect(getAlignment("high", "leve").kind).toBe("false_alarm");
  });

  it("attention + leve = Modelo conservador", () => {
    expect(getAlignment("attention", "leve").label).toContain("conservador");
  });

  it("moderate + leve = Modelo conservador", () => {
    expect(getAlignment("moderate", "leve").kind).toBe("conservative");
  });

  it("high + moderado = Modelo conservador", () => {
    expect(getAlignment("high", "moderado").kind).toBe("conservative");
  });

  it("critical + moderado = Modelo conservador", () => {
    expect(getAlignment("critical", "moderado").label).toContain("conservador");
  });

  it("cobre todos os 15 pares modelo x gravidade sem cair no fallback 'Indefinido'", () => {
    const levels = ["normal", "attention", "moderate", "high", "critical"] as const;
    const severities = ["leve", "moderado", "grave"] as const;
    for (const level of levels) {
      for (const severity of severities) {
        expect(getAlignment(level, severity).label).not.toBe("Indefinido");
      }
    }
  });
});
