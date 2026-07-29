import { describe, it, expect } from "vitest";
import { calculateScore } from "@/lib/score";
import { SCORE_THRESHOLDS } from "@/lib/constants";
import type { NormalizedWeather } from "@/types";

// calculateScore(neighborhood, weather, tideLevel, tideLastUpdated?, state?) --
// não é a assinatura de objeto único imaginada no pedido original (nenhuma
// função do projeto recebe um objeto {rain_peak_3h, rain_1h, ...} direto).
// Helper monta o NormalizedWeather completo (11 campos) já que a função real
// exige o tipo inteiro, não um subconjunto.
function weather(overrides: Partial<NormalizedWeather> = {}): NormalizedWeather {
  return {
    rain_1h: 0,
    rain_3h: 0,
    rain_72h: 0,
    rain_intensity: 0,
    rain_peak_3h: 0,
    rain_source: "openmeteo",
    wind_speed: 0,
    wind_direction: 0,
    humidity: 50,
    pressure: 1013,
    pressure_trend: "stable",
    ...overrides,
  };
}

const NEUTRAL_NEIGHBORHOOD = { terrain_slope: 0.5, hydro_proximity: 0.5, is_coastal: false };

describe("calculateScore", () => {
  it("retorna normal quando sem chuva", () => {
    const result = calculateScore(NEUTRAL_NEIGHBORHOOD, weather(), null);
    expect(result.level).toBe("normal");
    expect(result.score).toBeLessThan(SCORE_THRESHOLDS.ATTENTION);
  });

  it("retorna critical com chuva extrema", () => {
    const result = calculateScore(
      { terrain_slope: 0.1, hydro_proximity: 0.9, is_coastal: false },
      weather({ rain_peak_3h: 30, rain_1h: 50, rain_72h: 100 }),
      0.9
    );
    expect(result.level).toBe("critical");
    expect(result.score).toBeGreaterThan(SCORE_THRESHOLDS.CRITICAL);
  });

  it("dispara auto_critical por chuva extrema (Regra 1)", () => {
    const result = calculateScore(NEUTRAL_NEIGHBORHOOD, weather({ rain_1h: 51 }), null);
    expect(result.auto_critical).toBe(true);
    expect(result.level).toBe("critical");
  });

  it("NÃO dispara auto_critical com rain_1h de ruído (< 1mm), mesmo com solo saturado", () => {
    const result = calculateScore(NEUTRAL_NEIGHBORHOOD, weather({ rain_1h: 0.05, rain_72h: 110 }), null);
    // rain_72h > 100 mas rain_1h < 1 -- Regra 3 NÃO deve disparar
    expect(result.auto_critical).toBe(false);
  });

  it("dispara auto_critical por solo saturado (Regra 3)", () => {
    const result = calculateScore(NEUTRAL_NEIGHBORHOOD, weather({ rain_1h: 2, rain_72h: 110 }), null);
    expect(result.auto_critical).toBe(true);
    expect(result.auto_critical_reason).toContain("saturado");
  });

  it("dispara auto_critical por maré alta + chuva costeira (Regra 2), só com dado de maré recente", () => {
    const recent = new Date().toISOString();
    const result = calculateScore(
      { terrain_slope: 0.5, hydro_proximity: 0.5, is_coastal: true },
      weather({ rain_3h: 25 }),
      0.9,
      recent
    );
    expect(result.auto_critical).toBe(true);
    expect(result.auto_critical_reason).toContain("Maré");
  });

  it("NÃO dispara Regra 2 se o dado de maré estiver velho (>26h)", () => {
    const stale = new Date(Date.now() - 30 * 3_600_000).toISOString();
    const result = calculateScore(
      { terrain_slope: 0.5, hydro_proximity: 0.5, is_coastal: true },
      weather({ rain_3h: 25 }),
      0.9,
      stale
    );
    expect(result.auto_critical).toBe(false);
  });

  it("redistribui o peso da maré quando tideLevel é null (cidade sem tide_code)", () => {
    // Mesma chuva/terreno/hidrografia, com e sem maré -- sem maré, os pesos
    // das demais variáveis devem ser maiores (redistribuição), não iguais.
    const withoutTide = calculateScore(NEUTRAL_NEIGHBORHOOD, weather({ rain_72h: 60 }), null);
    const withTide = calculateScore(NEUTRAL_NEIGHBORHOOD, weather({ rain_72h: 60 }), 0);
    expect(withoutTide.score).not.toBe(withTide.score);
  });
});
