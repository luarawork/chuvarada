import { describe, it, expect, vi, afterEach } from "vitest";
import { getDailyRainForecast } from "@/lib/riskForecast";

// 9 dias (past_days=2 + forecast_days=7), 24h cada, chuva constante por dia
// pra facilitar conferir a soma na mão. Dia índice 2 = "hoje" (primeiro dia
// devolvido depois do slice que descarta os 2 dias passados).
const DAILY_RAIN_MM_PER_HOUR = [0.5, 1, 1.5, 0, 0, 0, 0, 0, 0]; // 9 dias
const START_DATE = new Date("2026-07-20T00:00:00Z");

function buildMockOpenMeteoResponse() {
  const time: string[] = [];
  const precipitation: number[] = [];
  for (let day = 0; day < 9; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const date = new Date(START_DATE);
      date.setUTCDate(date.getUTCDate() + day);
      date.setUTCHours(hour);
      time.push(date.toISOString().slice(0, 13) + ":00");
      precipitation.push(DAILY_RAIN_MM_PER_HOUR[day]);
    }
  }
  return { hourly: { time, precipitation } };
}

function mockFetchOnce() {
  const response = buildMockOpenMeteoResponse();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => response,
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getDailyRainForecast", () => {
  it("retorna exatamente 7 dias de previsão", async () => {
    mockFetchOnce();
    const forecast = await getDailyRainForecast(-23.55, -46.63);
    expect(forecast).toHaveLength(7);
  });

  it("calcula rain_72h_accumulated somando o dia + 2 dias anteriores", async () => {
    mockFetchOnce();
    const forecast = await getDailyRainForecast(-23.55, -46.63);

    // Primeiro dia devolvido = "hoje" (índice 2 da série de 9 dias mockada):
    // 24h * 1.5mm (hoje) + 24h * 1mm (ontem) + 24h * 0.5mm (anteontem) = 72mm.
    expect(forecast[0].rain_72h_accumulated).toBeCloseTo(72, 1);
    expect(forecast[0].rain_total).toBeCloseTo(36, 1); // 24h * 1.5mm

    // Segundo dia devolvido ("amanhã", índice 3, sem chuva nenhuma):
    // 24h*0 (amanhã) + 24h*1.5 (hoje) + 24h*1 (ontem) = 60mm.
    expect(forecast[1].rain_72h_accumulated).toBeCloseTo(60, 1);
  });

  it("confiança decai de 1.0 (hoje) até 0.4 no 7º dia", async () => {
    mockFetchOnce();
    const forecast = await getDailyRainForecast(-23.55, -46.63);

    expect(forecast[0].confidence).toBeCloseTo(1.0, 5);
    expect(forecast[6].confidence).toBeCloseTo(0.4, 5);
    // decaimento linear, monotonicamente não-crescente
    for (let i = 1; i < forecast.length; i++) {
      expect(forecast[i].confidence).toBeLessThanOrEqual(forecast[i - 1].confidence);
    }
  });

  it("propaga erro quando o Open-Meteo responde com falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    await expect(getDailyRainForecast(-23.55, -46.63)).rejects.toThrow();
  });
});
