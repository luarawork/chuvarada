import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateScore } from "@/lib/score";
import { mergeNewerScores } from "@/lib/mergeScores";
import { getBestRainData } from "@/lib/weather";
import { rainLabel } from "@/components/panel/HourlyForecast";
import { formatTaxaConfirmacao, MIN_AMOSTRA_CONFIRMACAO } from "@/lib/analiseMetrics";
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

describe(
  "Regressão -- HourlyForecast/rainLabel (03/08/2026): chuva fraca real (0,1-0,49mm) " +
    "aparecia como '0mm' porque a decisão de mostrar a unidade usava o valor bruto " +
    "(rain > 0) enquanto o número exibido já tinha sido arredondado sem decimais",
  () => {
    it("dado rain=0 (sem chuva de verdade), quando rainLabel formata o valor, então deve retornar string vazia (sem número, sem unidade)", () => {
      expect(rainLabel(0)).toBe("");
    });

    it("dado rain=0.3 (chuva fraca real, reproduz o bug), quando rainLabel formata o valor, então deve retornar '<1mm' em vez de '0mm'", () => {
      expect(rainLabel(0.3)).toBe("<1mm");
    });

    it("dado rain=0.99 (ainda abaixo de 1mm), quando rainLabel formata o valor, então deve retornar '<1mm'", () => {
      expect(rainLabel(0.99)).toBe("<1mm");
    });

    it("dado rain=1 (exatamente 1mm), quando rainLabel formata o valor, então deve retornar '1mm'", () => {
      expect(rainLabel(1)).toBe("1mm");
    });

    it("dado rain=2.6 (chuva com decimal acima de 1mm), quando rainLabel formata o valor, então deve arredondar pro inteiro mais próximo ('3mm')", () => {
      expect(rainLabel(2.6)).toBe("3mm");
    });
  }
);

describe(
  "Regressão -- /analise métricas (04/08/2026): 'Taxa média de confirmação' mostrava " +
    "percentual mesmo com amostra estatisticamente inútil (n=1), e 'Cobertura de dados' " +
    "divergia da própria tabela expandida (0% no card vs 100% em todos os estados)",
  () => {
    it("dado menos de 5 relatos com reação (amostra pequena demais), quando formatTaxaConfirmacao decide o que exibir, então deve retornar '—' em vez de um percentual enganoso", () => {
      expect(formatTaxaConfirmacao(100, 1)).toBe("—");
      expect(formatTaxaConfirmacao(100, MIN_AMOSTRA_CONFIRMACAO - 1)).toBe("—");
    });

    it("dado 0 relatos com reação (taxa null vinda da API), quando formatTaxaConfirmacao decide o que exibir, então deve retornar '—'", () => {
      expect(formatTaxaConfirmacao(null, 0)).toBe("—");
    });

    it("dado 5 ou mais relatos com reação (amostra suficiente), quando formatTaxaConfirmacao decide o que exibir, então deve retornar o percentual formatado", () => {
      expect(formatTaxaConfirmacao(72, MIN_AMOSTRA_CONFIRMACAO)).toBe("72%");
      expect(formatTaxaConfirmacao(50, 40)).toBe("50%");
    });

    it("dado o SQL de cobertura_dados em app/api/analise/metrics/route.ts, quando a query é inspecionada, então deve medir cobertura via city_risk_summary (mesma definição de pct_com_score da tabela expandida) e não mais via cities.data_level = 'full'", () => {
      const source = readFileSync(
        join(process.cwd(), "app/api/analise/metrics/route.ts"),
        "utf-8"
      );

      expect(source).toContain("city_risk_summary");
      // regex mira só a cláusula SQL do bug antigo (filter/where data_level =
      // 'full'), não a explicação em prosa no comentário histórico do arquivo
      expect(source).not.toMatch(/filter\s*\(\s*where\s+data_level\s*=\s*'full'/i);
    });
  }
);

describe(
  "Regressão -- lock do Cron A com TTL menor que o timeout do workflow (08-09/08/2026): " +
    "LOCK_MAX_AGE_MINUTES=10 e --max-time 570 (9.5min) do workflow deixavam margem quase " +
    "nula -- um ciclo só um pouco mais lento que o normal (banco sob carga) fazia o lock " +
    "expirar como 'stale' antes de terminar, permitindo uma segunda execução duplicar a " +
    "rodada inteira (achado real: todo o Brasil com score em dobro em 2 das últimas 24h)",
  () => {
    // LOCK_MAX_AGE_MINUTES não é importável direto -- route.ts só pode
    // exportar handlers HTTP reconhecidos pelo App Router (ver comentário
    // no próprio arquivo), então o valor é extraído do código-fonte.
    function readLockMaxAgeMinutes(): number {
      const source = readFileSync(join(process.cwd(), "app/api/cron/scores/route.ts"), "utf-8");
      const match = source.match(/LOCK_MAX_AGE_MINUTES\s*=\s*(\d+)/);
      if (!match) throw new Error("LOCK_MAX_AGE_MINUTES não encontrado em app/api/cron/scores/route.ts");
      return Number(match[1]);
    }

    it("dado o timeout de 570s (9.5min) do workflow merge-and-scores-update.yml, quando comparado ao TTL do lock, então o TTL deve ser estritamente maior -- nunca igual/menor, senão uma execução legítima um pouco lenta já duplica a rodada", () => {
      const WORKFLOW_TIMEOUT_SECONDS = 570;
      const LOCK_MAX_AGE_SECONDS = readLockMaxAgeMinutes() * 60;

      expect(LOCK_MAX_AGE_SECONDS).toBeGreaterThan(WORKFLOW_TIMEOUT_SECONDS);
    });

    it("dado o índice único risk_scores_neighborhood_hour_uniq (migração 040), quando insertRiskScoresBatch insere um lote, então o INSERT deve ter ON CONFLICT DO NOTHING casando com esse índice -- defesa em profundidade caso o lock falhe por outro motivo", () => {
      const source = readFileSync(join(process.cwd(), "lib/riskScoring.ts"), "utf-8");

      expect(source).toMatch(/on conflict\s*\(\s*neighborhood_id\s*,\s*\(date_trunc\('hour',\s*calculated_at at time zone 'utc'\)\)\s*\)\s*do nothing/i);
    });
  }
);
