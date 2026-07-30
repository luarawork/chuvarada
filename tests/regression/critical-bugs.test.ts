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

describe("Regressão -- Bug #34/#35: select * quebrando com a coluna geometry removida", () => {
  it("calculateScore não depende de geometry nenhuma -- só terrain_slope/hydro_proximity/is_coastal", () => {
    // A migração 032 removeu neighborhoods.geometry; o bug real era o SELECT
    // (n.* / select *) trazendo campos a menos depois disso, não o motor de
    // score em si -- mas o motor É a garantia de que, mesmo sem geometry
    // nenhuma no objeto, o cálculo continua funcionando normalmente.
    const neighborhood = { terrain_slope: 0.3, hydro_proximity: 0.8, is_coastal: false };
    expect(() => calculateScore(neighborhood, weather({ rain_peak_3h: 10, rain_1h: 5, rain_72h: 50 }), 0.5)).not.toThrow();
  });
});

describe("Regressão -- Bug Regra 3: ruído disparando crítico", () => {
  it("rain_1h de 0.05mm NÃO dispara Regra 3 mesmo com solo muito saturado", () => {
    const result = calculateScore(
      { terrain_slope: 0.3, hydro_proximity: 0.7, is_coastal: false },
      weather({ rain_1h: 0.05, rain_72h: 150 }),
      0.5
    );
    expect(result.auto_critical).toBe(false);
    expect(result.auto_critical_reason).toBeNull();
  });

  it("rain_1h de 1.5mm dispara Regra 3 com solo saturado", () => {
    const result = calculateScore(
      { terrain_slope: 0.3, hydro_proximity: 0.7, is_coastal: false },
      weather({ rain_1h: 1.5, rain_72h: 150 }),
      0.5
    );
    expect(result.auto_critical).toBe(true);
  });
});

describe("Regressão -- mergeNewerScores: score antigo não sobrescreve novo", () => {
  it("score mais recente vence sempre, mesmo chegando depois", () => {
    const existing = {
      "bairro-1": riskScore({ score: 0.8, level: "critical", calculated_at: "2026-07-28T10:00:00Z" }),
    };
    const olderIncoming = {
      "bairro-1": riskScore({ score: 0.2, level: "normal", calculated_at: "2026-07-28T09:00:00Z" }), // MAIS ANTIGO
    };

    const result = mergeNewerScores(existing, olderIncoming);
    expect(result["bairro-1"].level).toBe("critical");
  });

  it("um score realmente mais novo substitui o antigo", () => {
    const existing = {
      "bairro-1": riskScore({ score: 0.2, level: "normal", calculated_at: "2026-07-28T09:00:00Z" }),
    };
    const newerIncoming = {
      "bairro-1": riskScore({ score: 0.8, level: "critical", calculated_at: "2026-07-28T10:00:00Z" }),
    };

    const result = mergeNewerScores(existing, newerIncoming);
    expect(result["bairro-1"].level).toBe("critical");
  });

  it("bairro que só existe no incoming é adicionado normalmente", () => {
    const result = mergeNewerScores({}, { "bairro-novo": riskScore({ neighborhood_id: "bairro-novo" }) });
    expect(result["bairro-novo"]).toBeDefined();
  });
});

describe("Regressão -- caso Naviraí/Itaquiraí (MS): MERGE estagnado detectado via last_changed_at", () => {
  it("MERGE fresco e mudando normalmente -- comportamento de max()/prioridade inalterado", () => {
    const merge = mergeData({
      rain_72h: 50,
      rain_peak_3h: 10,
      fetched_at: new Date().toISOString(),
      last_changed_at: new Date().toISOString(), // mudou agora mesmo
    });
    const result = getBestRainData(merge, { rain_72h: 20, rain_peak_3h: 5 });

    expect(result.rain_source).toBe("merge_cptec_priority");
    expect(result.rain_72h).toBe(50);
  });

  it("fetched_at fresco mas last_changed_at travado há >24h -- prioriza Open-Meteo (bug real de 30/07/2026)", () => {
    // Reproduz exatamente o que aconteceu em Naviraí/Itaquiraí: fetched_at
    // continuava avançando (is_near_neighborhood mudando) enquanto
    // rain_72h/rain_peak_3h ficaram travados em ~120mm por 45+ horas depois
    // que a chuva real (~101mm em 22-24/07) já tinha passado.
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
  });
});
