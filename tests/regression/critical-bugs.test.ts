import { describe, it, expect } from "vitest";
import { calculateScore } from "@/lib/score";
import { mergeNewerScores } from "@/lib/mergeScores";
import { getBestRainData } from "@/lib/weather";
import type { MergeData } from "@/lib/merge";
import type { NormalizedWeather, RiskScore } from "@/types";

function mergeData(overrides: Partial<MergeData> = {}): MergeData {
  return {
    rain_72h: 0,
    rain_peak_3h: 0,
    source: "merge",
    fetched_at: new Date().toISOString(),
    last_changed_at: new Date().toISOString(),
    ...overrides,
  };
}

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

function riskScore(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    id: "score-1",
    neighborhood_id: "bairro-1",
    score: 0.2,
    level: "normal",
    rain_1h: 0,
    rain_72h: 0,
    rain_intensity: 0,
    rain_peak_3h: 0,
    rain_source: "openmeteo",
    terrain_slope: 0.5,
    hydro_proximity: 0.5,
    tide_level: 0.5,
    wind_speed: 0,
    wind_direction: 0,
    humidity: 50,
    pressure: 1013,
    auto_critical: false,
    auto_critical_reason: null,
    calculated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe(
  "Regressão -- Bug #34/#35 (jul/2026): migração 032 removeu neighborhoods.geometry, " +
    "select */n.* trazendo campos a menos quebrou o cálculo de score em produção",
  () => {
    it(
      "dado um bairro sem o campo geometry (só terrain_slope/hydro_proximity/is_coastal), " +
        "quando o score é calculado, " +
        "então calculateScore não deve lançar erro -- o motor de score nunca dependeu de geometry",
      () => {
        const neighborhood = { terrain_slope: 0.3, hydro_proximity: 0.8, is_coastal: false };
        expect(() => calculateScore(neighborhood, weather({ rain_peak_3h: 10, rain_1h: 5, rain_72h: 50 }), 0.5)).not.toThrow();
      }
    );
  }
);

describe("Regressão -- Bug Regra 3: limiar em 0 aceitava ruído de sensor como chuva real", () => {
  it(
    "dado rain_1h de 0,05mm (ruído de sensor/arredondamento) com solo muito saturado (rain_72h=150mm), " +
      "quando o score é calculado, " +
      "então a Regra 3 NÃO deve disparar auto_critical",
    () => {
      const result = calculateScore(
        { terrain_slope: 0.3, hydro_proximity: 0.7, is_coastal: false },
        weather({ rain_1h: 0.05, rain_72h: 150 }),
        0.5
      );
      expect(result.auto_critical).toBe(false);
      expect(result.auto_critical_reason).toBeNull();
    }
  );

  it(
    "dado rain_1h de 1,5mm (chuva real, não ruído) com solo saturado (rain_72h=150mm), " +
      "quando o score é calculado, " +
      "então a Regra 3 deve disparar auto_critical",
    () => {
      const result = calculateScore(
        { terrain_slope: 0.3, hydro_proximity: 0.7, is_coastal: false },
        weather({ rain_1h: 1.5, rain_72h: 150 }),
        0.5
      );
      expect(result.auto_critical).toBe(true);
    }
  );
});

describe("Regressão -- mergeNewerScores: score antigo não sobrescreve novo", () => {
  it("dado um score novo já salvo e um score mais antigo chegando depois (fora de ordem), quando os dois são mesclados, então o score mais recente por calculated_at deve vencer sempre", () => {
    const existing = {
      "bairro-1": riskScore({ score: 0.8, level: "critical", calculated_at: "2026-07-28T10:00:00Z" }),
    };
    const olderIncoming = {
      "bairro-1": riskScore({ score: 0.2, level: "normal", calculated_at: "2026-07-28T09:00:00Z" }), // MAIS ANTIGO
    };

    const result = mergeNewerScores(existing, olderIncoming);
    expect(result["bairro-1"].level).toBe("critical");
  });

  it("dado um score realmente mais novo chegando (por calculated_at), quando os dois são mesclados, então o mais novo deve substituir o antigo", () => {
    const existing = {
      "bairro-1": riskScore({ score: 0.2, level: "normal", calculated_at: "2026-07-28T09:00:00Z" }),
    };
    const newerIncoming = {
      "bairro-1": riskScore({ score: 0.8, level: "critical", calculated_at: "2026-07-28T10:00:00Z" }),
    };

    const result = mergeNewerScores(existing, newerIncoming);
    expect(result["bairro-1"].level).toBe("critical");
  });

  it("dado um bairro que só existe no lote incoming (nunca visto antes), quando os dois são mesclados, então esse bairro deve ser adicionado normalmente ao resultado", () => {
    const result = mergeNewerScores({}, { "bairro-novo": riskScore({ neighborhood_id: "bairro-novo" }) });
    expect(result["bairro-novo"]).toBeDefined();
  });
});

describe(
  "Regressão -- caso Naviraí/Itaquiraí, MS (30/07/2026): rain_72h ficou travado em ~120mm " +
    "por 45h+ depois que a chuva real (~101mm em 22-24/07) já tinha passado, MERGE estagnado " +
    "agora é detectado via last_changed_at",
  () => {
    it(
      "dado um MERGE fresco (fetched_at e last_changed_at recentes), " +
        "quando getBestRainData decide a fonte de chuva, " +
        "então o comportamento de max()/prioridade deve continuar inalterado",
      () => {
        const merge = mergeData({
          rain_72h: 50,
          rain_peak_3h: 10,
          fetched_at: new Date().toISOString(),
          last_changed_at: new Date().toISOString(), // mudou agora mesmo
        });
        const result = getBestRainData(merge, { rain_72h: 20, rain_peak_3h: 5 });

        expect(result.rain_source).toBe("merge_cptec_priority");
        expect(result.rain_72h).toBe(50);
      }
    );

    it(
      "dado fetched_at recente mas last_changed_at travado há mais de 24h (reproduz o bug real), " +
        "quando getBestRainData decide a fonte de chuva, " +
        "então deve priorizar Open-Meteo sozinho em vez de reforçar o valor travado do MERGE",
      () => {
        const merge = mergeData({
          rain_72h: 120,
          rain_peak_3h: 30,
          fetched_at: new Date().toISOString(), // "fresco" pelo teto de 6h
          last_changed_at: new Date(Date.now() - 45 * 3_600_000).toISOString(), // travado há 45h
        });
        const result = getBestRainData(merge, { rain_72h: 12, rain_peak_3h: 3 });

        expect(result.rain_source).toBe("openmeteo_merge_stale");
        expect(result.rain_72h).toBe(12);
        expect(result.rain_peak_3h).toBe(3);
      }
    );
  }
);
