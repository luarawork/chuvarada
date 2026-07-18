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
  main?: { temp?: number };
  weather?: OwmWeatherDesc[];
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

// Previsão pra exibir no painel do bairro: condição atual + próximas ~12h
// (a API gratuita do OpenWeatherMap só dá passos de 3 em 3 horas, então
// "próximas 12h" vira 4 pontos: +3h, +6h, +9h, +12h).
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
  };

  const nowSeconds = Date.now() / 1000;
  const next12h: ForecastSlot[] = forecast.list
    .filter((entry) => entry.dt >= nowSeconds)
    .slice(0, 4)
    .map((entry) => ({
      time: new Date(entry.dt * 1000).toISOString(),
      temp: Math.round(entry.main?.temp ?? 0),
      rain: entry.rain?.["3h"] ?? 0,
      pop: entry.pop ?? 0,
      description: entry.weather?.[0]?.description ?? "",
      icon: entry.weather?.[0]?.icon ?? "01d",
    }));

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
