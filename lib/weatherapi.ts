// WeatherAPI.com (https://www.weatherapi.com) -- substitui a Open-Meteo como
// fonte primária das variáveis secundárias (rain_1h, vento, umidade,
// pressão) a partir de 21/07/2026. Motivo da troca: o plano Business
// contratado dá 10 milhões de chamadas/mês (~333 mil/dia), bem acima da
// cota diária gratuita da Open-Meteo (10.000/dia) que motivou toda a
// engenharia de otimização em lib/weather.ts (Opções 1-3 do plano de
// expansão nacional). rain_72h/rain_peak_3h continuam vindo do MERGE/CPTEC
// sem nenhuma alteração (ver lib/merge.ts) -- essa troca é só pra`s
// variáveis que a Open-Meteo ainda fornecia.
//
// Usa o endpoint forecast.json (não current.json) mesmo só precisando do
// clima ATUAL: current.json não devolve nenhuma série horária, e o cálculo
// de rain_3h/rain_intensity (pico das últimas 3h, não só o instante do
// cron -- achado do diagnóstico do mapa "todo verde" de 18-19/07/2026)
// precisa da série. forecast.json com days=1 inclui as horas já passadas
// do dia local (00h até agora) com precipitação observada, do mesmo jeito
// que a Open-Meteo já dava via past_days -- confirmado com uma chamada
// real de teste antes de escrever este código.
const BASE_URL = "https://api.weatherapi.com/v1";

interface WeatherApiForecastResponse {
  current: {
    last_updated_epoch: number;
    precip_mm: number;
    wind_kph: number;
    wind_degree: number;
    humidity: number;
    pressure_mb: number;
  };
  forecast: {
    forecastday: [
      {
        hour: { time_epoch: number; precip_mm: number }[];
      },
    ];
  };
}

export interface WeatherApiReading {
  rain_1h: number;
  rain_3h: number;
  wind_speed: number;
  wind_direction: number;
  humidity: number;
  pressure: number;
}

// Contador diário próprio, separado do da Open-Meteo (lib/weather.ts) --
// são cotas de provedores diferentes, e a Open-Meteo continua existindo
// como fallback com sua própria cota real de 10.000/dia. Misturar os dois
// contadores deixaria o fallback sem proteção nenhuma se a WeatherAPI
// consumisse o teto sozinha.
const MAX_CALLS_PER_DAY = 300_000;
const WARN_AT_PERCENT = 0.8;
const WARN_THRESHOLD = Math.floor(MAX_CALLS_PER_DAY * WARN_AT_PERCENT);

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

let currentUtcDay = utcDateString(new Date());
let callsToday = 0;
let warned80 = false;
let warned100 = false;

export class WeatherApiRateLimitExceededError extends Error {
  constructor() {
    super(`Limite interno de ${MAX_CALLS_PER_DAY} chamadas/dia à WeatherAPI atingido`);
    this.name = "WeatherApiRateLimitExceededError";
  }
}

function checkDailyRateLimit(): void {
  const today = utcDateString(new Date());
  if (today !== currentUtcDay) {
    currentUtcDay = today;
    callsToday = 0;
    warned80 = false;
    warned100 = false;
  }

  if (callsToday >= MAX_CALLS_PER_DAY) {
    if (!warned100) {
      console.warn(
        `[weatherapi] Limite de ${MAX_CALLS_PER_DAY} chamadas/dia atingido — ` +
          `pausando novas chamadas até a meia-noite UTC (caindo pro fallback da Open-Meteo onde disponível).`
      );
      warned100 = true;
    }
    throw new WeatherApiRateLimitExceededError();
  }

  callsToday++;
  if (!warned80 && callsToday >= WARN_THRESHOLD) {
    console.warn(
      `[weatherapi] ${callsToday} de ${MAX_CALLS_PER_DAY} chamadas diárias usadas ` +
        `(${Math.round(WARN_AT_PERCENT * 100)}%) — aproximando do limite diário.`
    );
    warned80 = true;
  }
}

// Mesmo espaçamento mínimo entre requisições já usado pra Open-Meteo (ver
// lib/weather.ts) -- proteção de rajada básica, independente de qualquer
// limite por segundo que o plano Business da WeatherAPI tenha.
const MIN_REQUEST_INTERVAL_MS = 20;
let nextSlotAt = 0;

async function throttleWeatherApi(): Promise<void> {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextSlotAt);
  nextSlotAt = scheduledAt + MIN_REQUEST_INTERVAL_MS;
  const wait = scheduledAt - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function fetchWeatherApi(lat: number, lng: number): Promise<WeatherApiForecastResponse> {
  const apiKey = process.env.WEATHERAPI_KEY;
  if (!apiKey) throw new Error("WEATHERAPI_KEY não configurada");

  const url = `${BASE_URL}/forecast.json?key=${apiKey}&q=${lat},${lng}&days=1&aqi=no&alerts=no`;

  for (let attempt = 0; attempt <= 5; attempt++) {
    checkDailyRateLimit();
    await throttleWeatherApi();
    const res = await fetch(url);
    if (res.ok) return res.json();

    // 429 = limite de taxa transitório da WeatherAPI. Mesmo backoff
    // exponencial já usado pra Open-Meteo (2s, 4s, 8s, 16s, 32s).
    if (res.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`WeatherAPI falhou: ${res.status}`);
  }
  throw new Error("WeatherAPI falhou: esgotou tentativas");
}

export async function getWeatherApiReading(lat: number, lng: number): Promise<WeatherApiReading> {
  const data = await fetchWeatherApi(lat, lng);
  const nowEpoch = data.current.last_updated_epoch;
  const cutoff = nowEpoch - 3 * 3600;

  let rain3h = 0;
  for (const hour of data.forecast.forecastday[0].hour) {
    if (hour.time_epoch <= nowEpoch && hour.time_epoch > cutoff) rain3h += hour.precip_mm ?? 0;
  }

  return {
    rain_1h: data.current.precip_mm ?? 0,
    rain_3h: rain3h,
    wind_speed: data.current.wind_kph ?? 0,
    wind_direction: data.current.wind_degree ?? 0,
    humidity: data.current.humidity ?? 0,
    pressure: data.current.pressure_mb ?? 0,
  };
}
