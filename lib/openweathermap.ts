import { getDb } from "./db";
import type { ForecastResult, ForecastSlot, NormalizedWeather, PressureTrend, WeatherCache } from "@/types";

const API_KEY = process.env.OPENWEATHERMAP_API_KEY as string;
const CACHE_TTL_MINUTES = 20;

interface OwmWeatherDesc {
  description: string;
  icon: string;
}

interface OwmCurrentResponse {
  rain?: { "1h"?: number; "3h"?: number };
  wind?: { speed?: number; deg?: number };
  main?: { humidity?: number; pressure?: number; temp?: number };
  weather?: OwmWeatherDesc[];
}

interface OwmForecastEntry {
  dt: number;
  main?: { temp?: number; humidity?: number; pressure?: number };
  weather?: OwmWeatherDesc[];
  wind?: { speed?: number };
  rain?: { "3h"?: number };
  pop?: number;
}

interface OwmForecastResponse {
  list: OwmForecastEntry[];
}

function msToKmh(ms: number): number {
  return ms * 3.6;
}

export async function fetchCurrentWeather(lat: number, lng: number): Promise<OwmCurrentResponse> {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${API_KEY}&units=metric`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenWeatherMap weather falhou: ${res.status}`);
  return res.json();
}

async function fetchForecastRaw(lat: number, lng: number): Promise<OwmForecastResponse> {
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${API_KEY}&units=metric`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenWeatherMap forecast falhou: ${res.status}`);
  return res.json();
}

export async function fetchRain72h(lat: number, lng: number): Promise<number> {
  const data = await fetchForecastRaw(lat, lng);

  const cutoff = Date.now() / 1000 - 72 * 3600;
  return data.list
    .filter((entry) => entry.dt >= cutoff)
    .reduce((sum, entry) => sum + (entry.rain?.["3h"] ?? 0), 0);
}

interface ForecastPoint {
  dt: number;
  temp: number;
  rain3h: number;
  pop: number;
  icon: string;
  description: string;
  wind_speed: number;
  humidity: number;
  pressure: number;
}

// A API gratuita do OpenWeatherMap só dá passos de 3 em 3 horas. Pra mostrar
// 12 cards de hora em hora, interpola entre "agora" e os passos de 3h
// seguintes: temperatura interpolada linearmente, chuva do passo de 3h
// dividida igualmente pelas 3 horas que ele cobre, e chance de chuva/ícone
// herdados do passo de 3h em que a hora cai (não dá pra interpolar
// probabilidade de forma que faça sentido). É uma estimativa, não dado
// horário real — deixamos isso explícito na UI.
function interpolateHourly(points: ForecastPoint[], nowSeconds: number): ForecastSlot[] {
  const hourly: ForecastSlot[] = [];

  for (let h = 1; h <= 12; h++) {
    const targetTime = nowSeconds + h * 3600;

    let i = 0;
    while (i < points.length - 2 && points[i + 1].dt < targetTime) i++;
    const a = points[i];
    const b = points[Math.min(i + 1, points.length - 1)];

    const span = b.dt - a.dt || 1;
    const t = Math.min(1, Math.max(0, (targetTime - a.dt) / span));
    const temp = a.temp + (b.temp - a.temp) * t;

    hourly.push({
      time: new Date(targetTime * 1000).toISOString(),
      temp: Math.round(temp),
      rain: Math.round((b.rain3h / 3) * 10) / 10,
      pop: b.pop,
      description: b.description,
      icon: b.icon,
      wind_speed: Math.round(b.wind_speed),
      humidity: Math.round(b.humidity),
      pressure: Math.round(b.pressure),
    });
  }

  return hourly;
}

// Previsão pra exibir no painel do bairro: condição atual + próximas 12h,
// uma card por hora (interpoladas — ver interpolateHourly acima).
export async function fetchForecastDisplay(lat: number, lng: number): Promise<ForecastResult> {
  const [current, forecast] = await Promise.all([
    fetchCurrentWeather(lat, lng),
    fetchForecastRaw(lat, lng),
  ]);

  const currentSlot: ForecastSlot = {
    time: new Date().toISOString(),
    temp: Math.round(current.main?.temp ?? 0),
    rain: current.rain?.["1h"] ?? current.rain?.["3h"] ?? 0,
    pop: 0,
    description: current.weather?.[0]?.description ?? "",
    icon: current.weather?.[0]?.icon ?? "01d",
    wind_speed: Math.round(msToKmh(current.wind?.speed ?? 0)),
    humidity: Math.round(current.main?.humidity ?? 0),
    pressure: Math.round(current.main?.pressure ?? 0),
  };

  const nowSeconds = Date.now() / 1000;
  const futurePoints: ForecastPoint[] = forecast.list
    .filter((entry) => entry.dt >= nowSeconds)
    .slice(0, 5)
    .map((entry) => ({
      dt: entry.dt,
      temp: entry.main?.temp ?? currentSlot.temp,
      rain3h: entry.rain?.["3h"] ?? 0,
      pop: entry.pop ?? 0,
      icon: entry.weather?.[0]?.icon ?? "01d",
      description: entry.weather?.[0]?.description ?? "",
      wind_speed: msToKmh(entry.wind?.speed ?? 0),
      humidity: entry.main?.humidity ?? currentSlot.humidity,
      pressure: entry.main?.pressure ?? currentSlot.pressure,
    }));

  const points: ForecastPoint[] = [
    {
      dt: nowSeconds,
      temp: currentSlot.temp,
      rain3h: 0,
      pop: 0,
      icon: currentSlot.icon,
      description: currentSlot.description,
      wind_speed: currentSlot.wind_speed,
      humidity: currentSlot.humidity,
      pressure: currentSlot.pressure,
    },
    ...futurePoints,
  ];

  const next12h = interpolateHourly(points, nowSeconds);

  return { current: currentSlot, next12h };
}

function pressureTrend(current: number, previous: number | null): PressureTrend {
  if (previous === null) return "stable";
  const delta = current - previous;
  if (delta <= -1) return "falling";
  if (delta >= 1) return "rising";
  return "stable";
}

export async function getWeatherForCity(
  cityId: string,
  lat: number,
  lng: number
): Promise<NormalizedWeather> {
  const cached = await getCachedWeather(cityId);
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

  const [current, rain72h] = await Promise.all([
    fetchCurrentWeather(lat, lng),
    fetchRain72h(lat, lng),
  ]);

  const rain1h = current.rain?.["1h"] ?? 0;
  const rain3h = current.rain?.["3h"] ?? 0;
  const rainIntensity = Math.max(rain1h, rain3h / 3);

  const normalized: NormalizedWeather = {
    rain_1h: rain1h,
    rain_3h: rain3h,
    rain_72h: rain72h,
    rain_intensity: rainIntensity,
    wind_speed: msToKmh(current.wind?.speed ?? 0),
    wind_direction: current.wind?.deg ?? 0,
    humidity: current.main?.humidity ?? 0,
    pressure: current.main?.pressure ?? 1013,
    pressure_trend: pressureTrend(current.main?.pressure ?? 1013, cached?.pressure ?? null),
  };

  await saveWeatherCache(cityId, normalized);
  return normalized;
}

export async function saveWeatherCache(cityId: string, data: NormalizedWeather): Promise<void> {
  const db = getDb();
  await db.query(
    `insert into weather_cache (city_id, rain_1h, rain_72h, rain_intensity, wind_speed, wind_direction, humidity, pressure)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      cityId,
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

async function getCachedWeather(cityId: string): Promise<WeatherCache | null> {
  const db = getDb();
  const { rows } = await db.query(
    `select * from weather_cache where city_id = $1 order by fetched_at desc limit 1`,
    [cityId]
  );
  return rows[0] ?? null;
}
