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
  it(
    "dado que não há chuva em nenhuma variável, " +
      "quando o score é calculado, " +
      "então o nível deve ser normal e o score deve ficar abaixo do limiar de atenção (0,30)",
    () => {
      const result = calculateScore(NEUTRAL_NEIGHBORHOOD, weather(), null);
      expect(result.level).toBe("normal");
      expect(result.score).toBeLessThan(SCORE_THRESHOLDS.ATTENTION);
    }
  );

  it(
    "dado chuva extrema em rain_peak_3h/rain_1h/rain_72h com maré alta, " +
      "quando o score é calculado, " +
      "então o nível deve ser crítico e o score deve superar o limiar de crítico (0,60)",
    () => {
      const result = calculateScore(
        { terrain_slope: 0.1, hydro_proximity: 0.9, is_coastal: false },
        weather({ rain_peak_3h: 30, rain_1h: 50, rain_72h: 100 }),
        0.9
      );
      expect(result.level).toBe("critical");
      expect(result.score).toBeGreaterThan(SCORE_THRESHOLDS.CRITICAL);
    }
  );

  it(
    "dado rain_1h acima de 50mm (Regra 1), " +
      "quando o score é calculado, " +
      "então auto_critical deve ser true e o nível deve ser crítico",
    () => {
      const result = calculateScore(NEUTRAL_NEIGHBORHOOD, weather({ rain_1h: 51 }), null);
      expect(result.auto_critical).toBe(true);
      expect(result.level).toBe("critical");
    }
  );

  it(
    "dado rain_72h acima de 100mm mas rain_1h de ruído de sensor (< 1mm) -- Regra 3, " +
      "quando o score é calculado, " +
      "então auto_critical NÃO deve disparar, mesmo com solo saturado",
    () => {
      const result = calculateScore(NEUTRAL_NEIGHBORHOOD, weather({ rain_1h: 0.05, rain_72h: 110 }), null);
      expect(result.auto_critical).toBe(false);
    }
  );

  it(
    "dado rain_72h acima de 100mm e rain_1h acima de 1mm (Regra 3), " +
      "quando o score é calculado, " +
      "então auto_critical deve disparar com motivo de solo saturado",
    () => {
      const result = calculateScore(NEUTRAL_NEIGHBORHOOD, weather({ rain_1h: 2, rain_72h: 110 }), null);
      expect(result.auto_critical).toBe(true);
      expect(result.auto_critical_reason).toContain("saturado");
    }
  );

  it(
    "dado bairro costeiro com maré >80%, chuva de 3h >20mm e dado de maré atualizado há menos de 26h (Regra 2), " +
      "quando o score é calculado, " +
      "então auto_critical deve disparar com motivo relacionado à maré",
    () => {
      const recent = new Date().toISOString();
      const result = calculateScore(
        { terrain_slope: 0.5, hydro_proximity: 0.5, is_coastal: true },
        weather({ rain_3h: 25 }),
        0.9,
        recent
      );
      expect(result.auto_critical).toBe(true);
      expect(result.auto_critical_reason).toContain("Maré");
    }
  );

  it(
    "dadas as mesmas condições de maré alta + chuva costeira, mas com o dado de maré desatualizado há mais de 26h, " +
      "quando o score é calculado, " +
      "então a Regra 2 NÃO deve disparar (dado velho demais pra confiar)",
    () => {
      const stale = new Date(Date.now() - 30 * 3_600_000).toISOString();
      const result = calculateScore(
        { terrain_slope: 0.5, hydro_proximity: 0.5, is_coastal: true },
        weather({ rain_3h: 25 }),
        0.9,
        stale
      );
      expect(result.auto_critical).toBe(false);
    }
  );

  it(
    "dado o mesmo clima/terreno/hidrografia calculado com e sem tideLevel (cidade sem tide_code), " +
      "quando o score é calculado, " +
      "então o resultado deve ser diferente -- o peso da maré é redistribuído entre as demais variáveis, não descartado",
    () => {
      const withoutTide = calculateScore(NEUTRAL_NEIGHBORHOOD, weather({ rain_72h: 60 }), null);
      const withTide = calculateScore(NEUTRAL_NEIGHBORHOOD, weather({ rain_72h: 60 }), 0);
      expect(withoutTide.score).not.toBe(withTide.score);
    }
  );
});
