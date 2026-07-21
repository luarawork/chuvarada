import { getDb } from "./db";
import { gridCell } from "./grid";
import { getMergeData } from "./merge";
import type { MergeData } from "./merge";
import type { ForecastResult, ForecastSlot, NormalizedWeather, PressureTrend, RainSource, WeatherCache } from "@/types";

// Acima disso, o MERGE é considerado velho demais mesmo que getMergeData()
// já não devesse ter devolvido nada nesse caso (mesmo limite de
// lib/merge.ts) — checado de novo aqui como defesa, não só confiança cega
// no que getMergeData já filtrou.
const MERGE_MAX_AGE_HOURS = 6;

interface RainReading {
  rain_72h: number;
  rain_peak_3h: number;
}

// Decide qual fonte de rain_72h/rain_peak_3h usar, em vez de sempre
// priorizar o MERGE cegamente (achado do relatório de testes pré-deploy:
// no evento real de Recife de 26/06/2026, o MERGE subestimou a chuva
// — 51,1mm contra 92,7mm da Open-Meteo — e a integração anterior sempre
// usava o MERGE quando disponível, entregando um resultado pior que a
// fonte que ele substituiu).
//
// Atenção: a primeira versão desta função (replicando literalmente o
// pseudocódigo do pedido) tinha um bug real, encontrado ao testar contra
// os dados reais de Recife: a condição "merge < openMeteo*2" cobre
// TAMBÉM os casos em que openMeteo é maior que merge (ex: 51,1 < 92,7*2),
// então o branch de "usar o maior dos dois" nunca era alcançado quando a
// Open-Meteo estava correta — o caso que essa mudança deveria justamente
// resolver. Corrigido comparando primeiro se a Open-Meteo é maior que o
// MERGE (não uma proporção fixa), antes de checar o quanto o MERGE
// supera a Open-Meteo.
export function getBestRainData(merge: MergeData | null, openMeteo: RainReading): RainReading & { rain_source: RainSource } {
  const mergeIsStale =
    !merge || new Date(merge.fetched_at).getTime() < Date.now() - MERGE_MAX_AGE_HOURS * 3_600_000;

  if (mergeIsStale) {
    return { rain_72h: openMeteo.rain_72h, rain_peak_3h: openMeteo.rain_peak_3h, rain_source: "openmeteo" };
  }

  // Open-Meteo maior que o MERGE (caso real: Recife 26/06 — o MERGE
  // subestimou um sistema de chuva mais amplo que o modelo numérico
  // global captou melhor). Conservador: usa o maior dos dois valores,
  // preferindo alertar a silenciar.
  if (openMeteo.rain_72h > merge.rain_72h) {
    return {
      rain_72h: Math.max(merge.rain_72h, openMeteo.rain_72h),
      rain_peak_3h: Math.max(merge.rain_peak_3h, openMeteo.rain_peak_3h),
      rain_source: "max_merge_openmeteo",
    };
  }

  // MERGE mais que o dobro da Open-Meteo (caso real: Natal 18/07 — a
  // Open-Meteo subestimou um evento convectivo localizado que o MERGE,
  // com resolução ~10km contra ~25km, capturou corretamente).
  if (merge.rain_72h > openMeteo.rain_72h * 2) {
    return { rain_72h: merge.rain_72h, rain_peak_3h: merge.rain_peak_3h, rain_source: "merge_cptec_priority" };
  }

  // MERGE igual ou até 2x maior que a Open-Meteo — as duas fontes
  // concordam dentro de uma margem razoável; usa o MERGE pela resolução
  // espacial melhor (~10km vs ~25km).
  return { rain_72h: merge.rain_72h, rain_peak_3h: merge.rain_peak_3h, rain_source: "merge_cptec" };
}

const CACHE_TTL_MINUTES = 20;

// Em dev/teste, força uso do cache mesmo expirado em vez de sempre buscar
// dado novo — evita esgotar a cota diária gratuita do Open-Meteo rodando o
// cron repetidas vezes durante desenvolvimento (foi exatamente isso que
// esgotou a cota no fim de semana de 18-19/07/2026).
const WEATHER_CACHE_ONLY = process.env.WEATHER_CACHE_ONLY === "true";

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

// Foi o que realmente esgotou a cota gratuita do Open-Meteo no fim de
// semana de 18-19/07/2026: o cron rodou ~1794 cidades repetidas vezes
// (cada rodada completa bate em ~2500+ células únicas) sem nenhum teto
// próprio, só descobrindo o esgotamento quando a API já retornava 429 de
// cota diária (indistinguível por status code de um rate-limit transitório
// — o backoff exponencial existente não ajuda em nada contra uma cota que
// só reseta no dia seguinte). Esse contador é uma trava própria, separada
// da cota da API: para de tentar chamadas novas bem antes de bater na cota
// real, e avisa no log em vez de só falhar silenciosamente depois de
// esgotar todas as tentativas de retry.
//
// Trocado de um teto "por hora" (500) pra um teto "por dia" (9.200):
// investigação de scripts/relatorio_testes_pos_correcao.md (Médio 5) achou
// que o gargalo real do Open-Meteo não é a taxa por hora (o plano gratuito
// permite 5.000/h — 10x o antigo limite interno), é a cota diária real de
// 10.000/dia, com HTTP 429 "Daily API request limit exceeded" de verdade
// quando estourada. 9.200/dia deixa ~800 de margem pras chamadas extras de
// fetchForecastDisplay (previsão exibida no painel de bairro).
//
// Atenção -- este teto continua sendo só um backstop de segurança, não uma
// garantia de que o consumo real cabe embaixo dele: mesmo com as 3
// otimizações de arquitetura (Opções 1-3, ver route.ts e as funções logo
// abaixo), a projeção medida em regime permanente pro Nordeste sozinho
// ficou em ~15.700 chamadas/dia -- acima até deste teto reduzido. Isso
// acontece porque, ao contrário do esperado, dias com MAIS chuva geram
// MAIS células passando no gatilho de "MERGE mostra chuva significativa"
// (mergeShowsSignificantRain), exigindo refresh a cada ciclo -- ou seja, o
// consumo sobe justamente nos dias em que o produto mais precisa estar
// certo. Este teto seguirá acionando fallback de cache em boa parte dos
// dias até uma redução adicional (grade mais grossa, ou plano pago) ser
// decidida.
const MAX_CALLS_PER_DAY = 9200;
const WARN_AT_PERCENT = 0.8;
const WARN_THRESHOLD = Math.floor(MAX_CALLS_PER_DAY * WARN_AT_PERCENT);

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

let currentUtcDay = utcDateString(new Date());
let callsToday = 0;
let warned80 = false;
let warned100 = false;

export class RateLimitExceededError extends Error {
  constructor() {
    super(`Limite interno de ${MAX_CALLS_PER_DAY} chamadas/dia ao Open-Meteo atingido`);
    this.name = "RateLimitExceededError";
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
        `[weather] Limite de ${MAX_CALLS_PER_DAY} chamadas/dia ao Open-Meteo atingido — ` +
          `pausando novas chamadas até a meia-noite UTC (usando cache onde disponível).`
      );
      warned100 = true;
    }
    throw new RateLimitExceededError();
  }

  callsToday++;
  if (!warned80 && callsToday >= WARN_THRESHOLD) {
    console.warn(
      `[weather] ${callsToday} de ${MAX_CALLS_PER_DAY} chamadas diárias ao Open-Meteo usadas ` +
        `(${Math.round(WARN_AT_PERCENT * 100)}%) — aproximando do limite diário.`
    );
    warned80 = true;
  }
}

// Opções 2+3 do plano de otimização pra expansão nacional: só chama a
// Open-Meteo quando realmente precisa, em vez de todo ciclo pra toda
// célula. Implementadas juntas porque uma depende da outra pra ser segura
// -- a Opção 2 sozinha (só pular quando o MERGE não mostra chuva) não tem
// nenhum teto de tempo, então uma célula parada num período seco há
// semanas nunca atualizaria vento/umidade/pressão/rain_1h; a Opção 3
// sozinha (só o teto de 24h) ainda deixaria o sistema cego a chuva nova
// por até 24h se não checasse o MERGE a cada ciclo. Juntas: reaproveita o
// cache enquanto (a) ele tiver menos de 24h E (b) o MERGE -- que já
// atualiza de graça, 1x/hora, independente da Open-Meteo -- não mostrar
// chuva significativa na célula. Sem MERGE disponível, busca sempre, por
// segurança (nunca deixa um bairro sem dado por causa desta otimização).
const SECONDARY_VARS_MAX_AGE_HOURS = 24;
const SIGNIFICANT_RAIN_72H_MM = 10;
const SIGNIFICANT_RAIN_PEAK_3H_MM = 2;

export function mergeShowsSignificantRain(merge: MergeData | null): boolean {
  if (!merge) return true;
  return merge.rain_72h > SIGNIFICANT_RAIN_72H_MM || merge.rain_peak_3h > SIGNIFICANT_RAIN_PEAK_3H_MM;
}

// Reconstrói o resultado a partir do cache existente (vento/umidade/
// pressão/rain_1h) combinado com o MERGE mais recente pra rain_72h/
// rain_peak_3h -- mesma lógica já usada como fallback de erro logo abaixo,
// promovida aqui a caminho normal quando decidimos não chamar a Open-Meteo.
function buildFromCacheAndMerge(cached: WeatherCache, merge: MergeData | null): NormalizedWeather {
  const fromCache = weatherFromCache(cached);
  if (!merge) return fromCache;
  const best = getBestRainData(merge, { rain_72h: fromCache.rain_72h, rain_peak_3h: fromCache.rain_peak_3h });
  return { ...fromCache, rain_72h: best.rain_72h, rain_peak_3h: best.rain_peak_3h, rain_source: best.rain_source };
}

async function fetchOpenMeteo(lat: number, lng: number): Promise<OpenMeteoResponse> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure` +
    `&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,surface_pressure,precipitation_probability` +
    `&past_days=3&forecast_days=2&timezone=UTC`;

  for (let attempt = 0; attempt <= 5; attempt++) {
    checkDailyRateLimit();
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

// rain_1h/rain_intensity só capturavam o valor exato da hora em que o cron
// rodava — um pico de chuva forte que dura menos que os 20 minutos entre
// execuções nunca aparecia (achado do diagnóstico do mapa "todo verde" do
// fim de semana de 18-19/07/2026: rain_72h real passava de 50mm em vários
// bairros, mas rain_1h/rain_intensity ficavam em 0 porque não estava
// chovendo no exato instante da leitura). Pega o MAIOR valor horário das
// últimas 3h em vez do valor pontual — captura o pico mesmo que já tenha
// passado dentro dessa janela.
function peakPrecipitation(data: OpenMeteoResponse, nowMs: number, hoursBack: number): number {
  const cutoff = nowMs - hoursBack * 3600 * 1000;
  let peak = 0;
  for (let i = 0; i < data.hourly.time.length; i++) {
    const t = Date.parse(`${data.hourly.time[i]}Z`);
    if (t <= nowMs && t > cutoff) peak = Math.max(peak, data.hourly.precipitation[i] ?? 0);
  }
  return peak;
}

function weatherFromCache(cached: WeatherCache): NormalizedWeather {
  return {
    rain_1h: cached.rain_1h,
    rain_3h: cached.rain_1h, // aproximação: cache não guarda rain_3h separado
    rain_72h: cached.rain_72h,
    rain_intensity: cached.rain_intensity,
    rain_peak_3h: cached.rain_peak_3h,
    rain_source: cached.rain_source ?? "openmeteo",
    wind_speed: cached.wind_speed,
    wind_direction: cached.wind_direction,
    humidity: cached.humidity,
    pressure: cached.pressure,
    pressure_trend: pressureTrend(cached.pressure, null),
  };
}

function pressureTrend(current: number, previous: number | null): PressureTrend {
  if (previous === null) return "stable";
  const delta = current - previous;
  if (delta <= -1) return "falling";
  if (delta >= 1) return "rising";
  return "stable";
}

// Cache em memória do processo pra previsão exibida no painel — antes essa
// função ia direto pro Open-Meteo em toda abertura de bairro, sem nenhum
// cache (só o cron passava por weather_cache). Bairros reabertos repetidas
// vezes em dev/teste dentro da mesma janela de 20min agora reaproveitam o
// resultado, e uma falha (cota esgotada ou limite interno) cai pro último
// resultado bom em vez de quebrar o painel.
interface CachedForecast {
  data: ForecastResult;
  fetchedAt: number;
}
const forecastMemCache = new Map<string, CachedForecast>();

// Previsão pra exibir no painel do bairro: condição atual + próximas 12h. A
// API já dá dado horário de verdade (diferente da OWM free, que só tinha
// passos de 3h e exigia interpolar) — nenhuma estimativa aqui.
export async function fetchForecastDisplay(lat: number, lng: number): Promise<ForecastResult> {
  const cell = gridCell(lat, lng);
  const cacheKey = `${cell.lat},${cell.lng}`;
  const cachedEntry = forecastMemCache.get(cacheKey);
  const ageMinutes = cachedEntry ? (Date.now() - cachedEntry.fetchedAt) / 60000 : Infinity;

  if (cachedEntry && (WEATHER_CACHE_ONLY || ageMinutes < CACHE_TTL_MINUTES)) {
    return cachedEntry.data;
  }

  let data: OpenMeteoResponse;
  try {
    data = await fetchOpenMeteo(cell.lat, cell.lng);
  } catch (err) {
    if (cachedEntry) {
      console.warn(
        `[weather] Falha ao buscar previsão nova (${(err as Error).message}) — ` +
          `usando cache expirado (${Math.round(ageMinutes)}min)`
      );
      return cachedEntry.data;
    }
    throw err;
  }
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

  const result: ForecastResult = { current: currentSlot, next12h };
  forecastMemCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  return result;
}

// Busca o clima pra um ponto específico (não pra cidade inteira). Bairros
// próximos caem na mesma célula de ~10km (lib/grid.ts) e reaproveitam o
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
    if (WEATHER_CACHE_ONLY || ageMinutes < CACHE_TTL_MINUTES) {
      return weatherFromCache(cached);
    }
  }

  // MERGE/CPTEC (satélite GPM/IMERG-Late fundido com pluviômetros do INMET,
  // grade ~10km) é consultado à parte da Open-Meteo, não dentro do mesmo
  // try/catch — os dois têm falhas independentes (cota/rate-limit da
  // Open-Meteo não tem nada a ver com o merge_cache estar desatualizado, e
  // vice-versa). Se ficassem no mesmo bloco, um limite interno da Open-Meteo
  // (ex: 500 chamadas/hora já atingido) faria o código pular direto pro
  // fallback de cache antigo e descartar o MERGE mesmo com dado fresco
  // disponível. Substitui rain_72h/rain_peak_3h quando há leitura recente o
  // bastante (<6h, ver lib/merge.ts) — captura eventos convectivos
  // localizados que o modelo numérico da Open-Meteo (grade ~25km) já
  // demonstrou subestimar (evento real de Natal, 18/07/2026, ver
  // scripts/proposta_integracao_merge_cptec.md). rain_1h continua da
  // Open-Meteo: o MERGE tem ~3,5h de latência, impróprio pra "última hora".
  let merge: Awaited<ReturnType<typeof getMergeData>> = null;
  try {
    merge = await getMergeData(lat, lng);
  } catch (mergeErr) {
    console.warn(`[weather] Falha ao consultar merge_cache pra ${cityId}: ${(mergeErr as Error).message} — usando Open-Meteo`);
  }

  // Opções 2+3 (ver comentário acima de mergeShowsSignificantRain): com
  // cache disponível e ainda dentro do teto de 24h, só vale a pena gastar
  // uma chamada à Open-Meteo se o MERGE indicar chuva -- fora isso, vento/
  // umidade/pressão/rain_1h dificilmente mudaram o bastante pra justificar
  // o custo, e rain_72h/rain_peak_3h já vêm atualizados pelo MERGE de graça.
  if (cached) {
    const cacheAgeHours = (Date.now() - new Date(cached.fetched_at).getTime()) / 3_600_000;
    if (cacheAgeHours <= SECONDARY_VARS_MAX_AGE_HOURS && !mergeShowsSignificantRain(merge)) {
      return buildFromCacheAndMerge(cached, merge);
    }
  }

  try {
    const data = await fetchOpenMeteo(cell.lat, cell.lng);
    const nowMs = Date.parse(`${data.current.time}Z`);

    const rain1h = data.current.precipitation ?? 0;
    const rain3h = sumPrecipitation(data, nowMs, 3);
    const rainIntensity = Math.max(rain1h, rain3h / 3);

    const best = getBestRainData(merge, {
      rain_72h: sumPrecipitation(data, nowMs, 72),
      rain_peak_3h: peakPrecipitation(data, nowMs, 3),
    });
    const rain72h = best.rain_72h;
    const rainPeak3h = best.rain_peak_3h;
    const rainSource = best.rain_source;

    const normalized: NormalizedWeather = {
      rain_1h: rain1h,
      rain_3h: rain3h,
      rain_72h: rain72h,
      rain_intensity: rainIntensity,
      rain_peak_3h: rainPeak3h,
      rain_source: rainSource,
      wind_speed: data.current.wind_speed_10m,
      wind_direction: data.current.wind_direction_10m,
      humidity: data.current.relative_humidity_2m,
      pressure: data.current.surface_pressure,
      pressure_trend: pressureTrend(data.current.surface_pressure, cached?.pressure ?? null),
    };

    await saveWeatherCache(cityId, cell.lat, cell.lng, normalized);
    return normalized;
  } catch (err) {
    // Cota diária esgotada (429) ou limite interno de chamadas/hora: usa o
    // cache expirado em vez de derrubar o bairro inteiro, se houver algo —
    // mas ainda sobrepõe rain_72h/rain_peak_3h do MERGE se tiver dado fresco,
    // já que esse problema é só da Open-Meteo, não do MERGE.
    if (cached) {
      console.warn(
        `[weather] Falha ao buscar clima novo pra ${cityId} (${(err as Error).message}) — ` +
          `usando cache expirado (${Math.round((Date.now() - new Date(cached.fetched_at).getTime()) / 60000)}min)`
      );
      return buildFromCacheAndMerge(cached, merge);
    }
    throw err;
  }
}

export async function saveWeatherCache(
  cityId: string,
  lat: number,
  lng: number,
  data: NormalizedWeather
): Promise<void> {
  const db = getDb();
  await db.query(
    `insert into weather_cache (city_id, lat, lng, rain_1h, rain_72h, rain_intensity, rain_peak_3h, rain_source, wind_speed, wind_direction, humidity, pressure)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      cityId,
      lat,
      lng,
      data.rain_1h,
      data.rain_72h,
      data.rain_intensity,
      data.rain_peak_3h,
      data.rain_source,
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
