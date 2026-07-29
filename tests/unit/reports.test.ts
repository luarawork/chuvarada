import { describe, it, expect } from "vitest";
import { calculateExpiresAt, calculateReportWeight } from "@/lib/reports";

describe("calculateExpiresAt", () => {
  it("relato leve expira em 30 minutos", () => {
    const expires = calculateExpiresAt("leve", 0);
    const diffMinutes = (expires.getTime() - Date.now()) / 1000 / 60;
    expect(diffMinutes).toBeCloseTo(30, 0);
  });

  it("relato moderado expira em 90 minutos", () => {
    const expires = calculateExpiresAt("moderado", 0);
    const diffMinutes = (expires.getTime() - Date.now()) / 1000 / 60;
    expect(diffMinutes).toBeCloseTo(90, 0);
  });

  it("relato grave expira em 180 minutos", () => {
    const expires = calculateExpiresAt("grave", 0);
    const diffMinutes = (expires.getTime() - Date.now()) / 1000 / 60;
    expect(diffMinutes).toBeCloseTo(180, 0);
  });

  it("cada confirmação adiciona 15 minutos", () => {
    const semConfirmacao = calculateExpiresAt("leve", 0);
    const comConfirmacao = calculateExpiresAt("leve", 1);
    const diff = (comConfirmacao.getTime() - semConfirmacao.getTime()) / 1000 / 60;
    expect(diff).toBeCloseTo(15, 0);
  });

  it("máximo de 2 horas de bônus por confirmações", () => {
    const semBonus = calculateExpiresAt("leve", 0);
    const comMuitasConfirmacoes = calculateExpiresAt("leve", 100);
    const diff = (comMuitasConfirmacoes.getTime() - semBonus.getTime()) / 1000 / 60;
    expect(diff).toBeLessThanOrEqual(120);
  });
});

describe("calculateReportWeight", () => {
  it("relato autenticado tem peso maior que anônimo", () => {
    const anonimo = calculateReportWeight(true, 0, 0);
    const autenticado = calculateReportWeight(false, 0, 0);
    expect(autenticado).toBeGreaterThan(anonimo);
  });

  it("confirmações aumentam o peso", () => {
    const semConfirmacao = calculateReportWeight(true, 0, 0);
    const comConfirmacao = calculateReportWeight(true, 5, 0);
    expect(comConfirmacao).toBeGreaterThan(semConfirmacao);
  });

  it("negações reduzem o peso líquido de confirmações", () => {
    const semNegacao = calculateReportWeight(true, 5, 0);
    const comNegacao = calculateReportWeight(true, 5, 5);
    expect(comNegacao).toBeLessThan(semNegacao);
  });

  it("nunca ultrapassa o teto de 2.0", () => {
    const result = calculateReportWeight(false, 1000, 0);
    expect(result).toBeLessThanOrEqual(2.0);
  });
});
