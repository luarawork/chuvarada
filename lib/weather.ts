import { getDb } from "./db";
import { gridCell } from "./grid";
import type { ForecastResult, ForecastSlot, NormalizedWeather, PressureTrend, WeatherCache } from "@/types";

const CACHE_TTL_MINUTES = 20;

// Open-Meteo (https://open-meteo.com) — gratuita, sem chave de API, e ao
// contrário da OpenWeatherMap free tier tem um parâmetro `past_days` que
// devolve chuva REALMENTE OBSERVADA nas últimas horas, não só previsão.
// Isso corrige um bug de origem: rain_72h era calculado a partir do endpoint
// de previsão (5 dias pra frente) da OWM porque o plano gratuito dela não
// tem endpoint de histórico — ou seja, chuva que já caiu e parou (ex: fim de
// semana chuvoso seguido de um dia seco) nunca aparecia no score de risco.
// Unidades já vêm no padrão que usamos (°C, km/h, mm, hPa) — sem conversão.
interface OpenMeteoResponse {
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    surface_pressure: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation: number[];
    weather_code: number[];
    wind_speed_10m: number[];
    relative_humidity_2m: number[];
    surface_pressure: number[];
    precipitation_probability: number[];
  };
}

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "céu limpo",
  1: "poucas nuvens",
  2: "parcialmente nublado",
  3: "nublado",
  45: "neblina",
  48: "neblina com geada",
  51: "garoa leve",
  53: "garoa",
  55: "garoa forte",
  56: "garoa congelante leve",
  57: "garoa congelante",
  61: "chuva leve",
  63: "chuva",
  65: "chuva forte",
  66: "chuva congelante leve",
  67: "chuva congelante",
  71: "neve leve",
  73: "neve",
  75: "neve forte",
  77: "grãos de neve",
  80: "pancadas de chuva leves",
  81: "pancadas de chuva",
  82: "pancadas de chuva fortes",
  85: "pancadas de neve leves",
  86: "pancadas de neve fortes",
  95: "trovoada",
  96: "trovoada com granizo leve",
  99: "trovoada com granizo forte",
};

// Limitador de taxa global (processo inteiro) pras chamadas ao Open-Meteo.
// O cron paraleliza cidades E células dentro de cada cidade — um limite de
// concorrência sozinho (ex: "4 de cada vez") não impede a taxa de início de
// requisição de disparar (várias terminam rápido e liberam vaga quase
// junto), e isso ainda batia em 429 mesmo com poucos requests concorrentes.
// Aqui o gate serializa só o INÍCIO de cada requisição com um espaçamento
// mínimo, deixando a resposta seguir em paralelo — throughput sustentado
// previsível independente de quantos callers concorrentes existem.
const MIN_REQUEST_INTERVAL_MS = 120;
let nextSlotAt = 0;

async function throttleOpenMeteo(): Promise<void> {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextSlotAt);
  nextSlotAt = scheduledAt + MIN_REQUEST_INTERVAL_MS;
  const wait = scheduledAt - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function fetchOpenMeteo(lat: number, lng: number): Promise<OpenMeteoResponse> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure` +
    `&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,surface_pressure,precipitation_probability` +
    `&past_days=3&forecast_days=2&timezone=UTC`;

  for (let attempt = 0; attempt <= 5; attempt++) {
    await throttleOpenMeteo();
    const res = await fetch(url);
    if (res.ok) return res.json();

    // 429 = limite de taxa do Open-Meteo (gratuito, sem chave). Espera com
    // backoff exponencial (2s, 4s, 8s, 16s, 32s) e tenta de novo em vez de
    // derrubar a cidade inteira por uma rajada momentânea.
    if (res.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`Open-Meteo falhou: ${res.status}`);
  }
  throw new Error("Open-Meteo falhou: esgotou tentativas");
}

function sumPrecipitation(data: OpenMeteoResponse, nowMs: number, hoursBack: number): number {
  const cutoff = nowMs - hoursBack * 3600 * 1000;
  let total = 0;
  for (let i = 0; i < data.hourly.time.length; i++) {
    const t = Date.parse(`${data.hourly.time[i]}Z`);
    if (t <= nowMs && t > cutoff) total += data.hourly.precipitation[i] ?? 0;
  }
  return total;
}

function pressureTrend(current: number, previous: number | null): PressureTrend {
  if (previous === null) return "stable";
  const delta = current - previous;
  if (delta <= -1) return "falling";
  if (delta >= 1) return "rising";
  return "stable";
}

// Previsão pra exibir no painel do bairro: condição atual + próximas 12h. A
// API já dá dado horário de verdade (diferente da OWM free, que só tinha
// passos de 3h e exigia interpolar) — nenhuma estimativa aqui.
export async function fetchForecastDisplay(lat: number, lng: number): Promise<ForecastResult> {
  const data = await fetchOpenMeteo(lat, lng);
  const nowMs = Date.parse(`${data.current.time}Z`);

  const currentSlot: ForecastSlot = {
    time: new Date(nowMs).toISOString(),
    temp: Math.round(data.current.temperature_2m),
    rain: data.current.precipitation ?? 0,
    pop: 0,
    description: WMO_DESCRIPTIONS[data.current.weather_code] ?? "",
    icon: String(data.current.weather_code),
    wind_speed: Math.round(data.current.wind_speed_10m),
    humidity: Math.round(data.current.relative_humidity_2m),
    pressure: Math.round(data.current.surface_pressure),
  };

  const next12h: ForecastSlot[] = data.hourly.time
    .map((time, i) => ({ index: i, ms: Date.parse(`${time}Z`) }))
    .filter(({ ms }) => ms > nowMs)
    .slice(0, 12)
    .map(({ index, ms }) => ({
      time: new Date(ms).toISOString(),
      temp: Math.round(data.hourly.temperature_2m[index]),
      rain: Math.round((data.hourly.precipitation[index] ?? 0) * 10) / 10,
      pop: (data.hourly.precipitation_probability[index] ?? 0) / 100,
      description: WMO_DESCRIPTIONS[data.hourly.weather_code[index]] ?? "",
      icon: String(data.hourly.weather_code[index]),
      wind_speed: Math.round(data.hourly.wind_speed_10m[index]),
      humidity: Math.round(data.hourly.relative_humidity_2m[index]),
      pressure: Math.round(data.hourly.surface_pressure[index]),
    }));

  return { current: currentSlot, next12h };
}

// Busca o clima pra um ponto específico (não pra cidade inteira). Bairros
// próximos caem na mesma célula de ~5km (lib/grid.ts) e reaproveitam o
// mesmo fetch/cache — cidades grandes como Salvador acabam com várias
// células distintas, capturando a variação real de chuva dentro da cidade
// em vez de um único valor pra cidade toda.
export async function getWeatherForPoint(
  cityId: string,
  lat: number,
  lng: number
): Promise<NormalizedWeather> {
  const cell = gridCell(lat, lng);
  const cached = await getCachedWeather(cityId, cell.lat, cell.lng);
  if (cached) {
    const ageMinutes = (Date.now() - new Date(cached.fetched_at).getTime()) / 60000;
    if (ageMinutes < CACHE_TTL_MINUTES) {
      return {
        rain_1h: cached.rain_1h,
        rain_3h: cached.rain_1h, // aproximação: cache não guarda rain_3h separado
        rain_72h: cached.rain_72h,
        rain_intensity: cached.rain_intensity,
        wind_speed: cached.wind_speed,
        wind_direction: cached.wind_direction,
        humidity: cached.humidity,
        pressure: cached.pressure,
        pressure_trend: pressureTrend(cached.pressure, null),
      };
    }
  }

  const data = await fetchOpenMeteo(cell.lat, cell.lng);
  const nowMs = Date.parse(`${data.current.time}Z`);

  const rain1h = data.current.precipitation ?? 0;
  const rain3h = sumPrecipitation(data, nowMs, 3);
  const rain72h = sumPrecipitation(data, nowMs, 72);
  const rainIntensity = Math.max(rain1h, rain3h / 3);

  const normalized: NormalizedWeather = {
    rain_1h: rain1h,
    rain_3h: rain3h,
    rain_72h: rain72h,
    rain_intensity: rainIntensity,
    wind_speed: data.current.wind_speed_10m,
    wind_direction: data.current.wind_direction_10m,
    humidity: data.current.relative_humidity_2m,
    pressure: data.current.surface_pressure,
    pressure_trend: pressureTrend(data.current.surface_pressure, cached?.pressure ?? null),
  };

  await saveWeatherCache(cityId, cell.lat, cell.lng, normalized);
  return normalized;
}

export async function saveWeatherCache(
  cityId: string,
  lat: number,
  lng: number,
  data: NormalizedWeather
): Promise<void> {
  const db = getDb();
  await db.query(
    `insert into weather_cache (city_id, lat, lng, rain_1h, rain_72h, rain_intensity, wind_speed, wind_direction, humidity, pressure)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      cityId,
      lat,
      lng,
      data.rain_1h,
      data.rain_72h,
      data.rain_intensity,
      data.wind_speed,
      data.wind_direction,
      data.humidity,
      data.pressure,
    ]
  );
}

async function getCachedWeather(cityId: string, lat: number, lng: number): Promise<WeatherCache | null> {
  const db = getDb();
  const { rows } = await db.query(
    `select * from weather_cache where city_id = $1 and lat = $2 and lng = $3 order by fetched_at desc limit 1`,
    [cityId, lat, lng]
  );
  return rows[0] ?? null;
}
