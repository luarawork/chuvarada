export type DataLevel = "full" | "partial" | "minimal";
export type RiskLevel = "normal" | "attention" | "critical";
export type PressureTrend = "falling" | "stable" | "rising";
export type NameSource = "bairro" | "subdistrito" | "distrito" | "setor";

export interface City {
  id: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  tide_code: string | null;
  data_level: DataLevel;
  active: boolean;
  created_at: string;
}

export interface Neighborhood {
  id: string;
  city_id: string;
  name: string;
  geometry: GeoJSON.Geometry;
  terrain_slope: number;
  hydro_proximity: number;
  is_coastal: boolean;
  name_source: NameSource | null;
  created_at: string;
}

export interface RiskScore {
  id: string;
  neighborhood_id: string;
  score: number;
  level: RiskLevel;
  rain_1h: number;
  rain_72h: number;
  rain_intensity: number;
  rain_peak_3h: number;
  terrain_slope: number;
  hydro_proximity: number;
  tide_level: number;
  wind_speed: number;
  wind_direction: number;
  humidity: number;
  pressure: number;
  auto_critical: boolean;
  auto_critical_reason: string | null;
  calculated_at: string;
}

export interface RiskEvent {
  id: string;
  neighborhood_id: string;
  level: RiskLevel;
  peak_score: number | null;
  started_at: string;
  ended_at: string | null;
  confirmed: boolean;
}

export interface TideDay {
  date: string;
  tides: { hour: string; level: number }[];
}

export interface TideCacheData {
  days: TideDay[];
  max_level: number;
  min_level: number;
}

export interface TideCache {
  id: string;
  city_id: string;
  month: number;
  year: number;
  data: TideCacheData;
  cached_at: string;
}

export type RainSource = "merge_cptec" | "openmeteo" | "merge_cptec_priority" | "max_merge_openmeteo";

export interface WeatherCache {
  id: string;
  city_id: string;
  lat: number;
  lng: number;
  rain_1h: number;
  rain_72h: number;
  rain_intensity: number;
  rain_peak_3h: number;
  rain_source: RainSource;
  wind_speed: number;
  wind_direction: number;
  humidity: number;
  pressure: number;
  fetched_at: string;
}

export interface NormalizedWeather {
  rain_1h: number;
  rain_3h: number;
  rain_72h: number;
  rain_intensity: number;
  rain_peak_3h: number;
  rain_source: RainSource;
  wind_speed: number;
  wind_direction: number;
  humidity: number;
  pressure: number;
  pressure_trend: PressureTrend;
}

export interface TideResult {
  level: number;
  estimated: boolean;
  note?: string;
  cached_at: string | null;
}

export interface ForecastSlot {
  time: string;
  temp: number;
  rain: number;
  pop: number;
  description: string;
  icon: string;
  wind_speed: number;
  humidity: number;
  pressure: number;
}

export interface ForecastResult {
  current: ForecastSlot;
  next12h: ForecastSlot[];
}

export interface ScoreBreakdown {
  rain_peak_3h: number;
  rain_1h: number;
  rain_72h: number;
  terrain_slope: number;
  hydro_proximity: number;
  tide_level: number;
}

export interface ScoreResult {
  score: number;
  level: RiskLevel;
  auto_critical: boolean;
  auto_critical_reason: string | null;
  breakdown: ScoreBreakdown;
}

export interface UserFavorite {
  id: string;
  user_id: string;
  neighborhood_id: string;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  neighborhood_id: string;
  level: RiskLevel;
  message: string | null;
  sent_at: string;
}
