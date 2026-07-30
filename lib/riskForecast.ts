import { throttledOpenMeteoFetch } from "./weather";

// Previsão de risco pros próximos 7 dias (painel "Previsão →" do bairro) --
// só a agregação meteorológica pura aqui, sem calculateScore/banco, pra ficar
// testável isoladamente (mock de fetch). A rota (app/api/forecast/
// [neighborhoodId]/route.ts) combina isso com as características estáticas
// do bairro pra chegar no score previsto de cada dia.
export interface DailyRainForecast {
  date: string; // YYYY-MM-DD
  rain_peak_3h: number; // maior soma de qualquer janela de 3h consecutivas DENTRO do dia (mm)
  rain_max_1h: number; // maior hora de chuva do dia (mm)
  rain_total: number; // total do dia (mm)
  rain_72h_accumulated: number; // soma do dia + 2 dias anteriores (mm)
  confidence: number; // 1.0 hoje, decaindo linearmente até 0.4 no 7º dia
}

interface OpenMeteoHourlyResponse {
  hourly: {
    time: string[];
    precipitation: number[];
  };
}

const FORECAST_DAYS = 7;
// past_days=2 é o que faz o rain_72h_accumulated de "hoje" já somar os 2 dias
// anteriores de verdade -- sem isso, o Open-Meteo só devolveria dado a partir
// de hoje, e os 2 primeiros "dias" que o cálculo espera (pra compor o
// acumulado de 72h) simplesmente não existiriam na resposta.
const PAST_DAYS = 2;

export async function getDailyRainForecast(lat: number, lng: number): Promise<DailyRainForecast[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=precipitation&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=America/Sao_Paulo`;

  const res = await throttledOpenMeteoFetch(url);
  if (!res.ok) throw new Error(`Open-Meteo (previsão 7 dias) falhou: ${res.status}`);
  const data: OpenMeteoHourlyResponse = await res.json();

  const times = data.hourly.time;
  const precip = data.hourly.precipitation;

  const byDay = new Map<string, number[]>();
  for (let i = 0; i < times.length; i++) {
    const date = times[i].slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date)!.push(precip[i] ?? 0);
  }

  const days = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));

  const result: DailyRainForecast[] = [];
  for (let i = 0; i < days.length; i++) {
    const [date, hours] = days[i];
    const total = hours.reduce((a, b) => a + b, 0);

    let peak3h = 0;
    for (let h = 0; h < hours.length - 2; h++) {
      const window = hours[h] + hours[h + 1] + hours[h + 2];
      if (window > peak3h) peak3h = window;
    }

    const prev2 = i >= 2 ? days[i - 2][1].reduce((a, b) => a + b, 0) : 0;
    const prev1 = i >= 1 ? days[i - 1][1].reduce((a, b) => a + b, 0) : 0;
    const rain72h = prev2 + prev1 + total;

    // Linear de 1.0 (índice 0, hoje) a 0.4 (índice 6, +6 dias) -- 6
    // intervalos entre 7 pontos, passo de 0.1.
    const dayIndex = i - PAST_DAYS;
    const confidence = Math.max(0.4, 1.0 - dayIndex * 0.1);

    result.push({
      date,
      rain_peak_3h: Math.round(peak3h * 10) / 10,
      rain_max_1h: hours.length > 0 ? Math.round(Math.max(...hours) * 10) / 10 : 0,
      rain_total: Math.round(total * 10) / 10,
      rain_72h_accumulated: Math.round(rain72h * 10) / 10,
      confidence,
    });
  }

  // Descarta os PAST_DAYS iniciais (só serviam pra compor o acumulado de
  // 72h de "hoje") e devolve exatamente os 7 dias de previsão de verdade.
  return result.slice(PAST_DAYS, PAST_DAYS + FORECAST_DAYS);
}
