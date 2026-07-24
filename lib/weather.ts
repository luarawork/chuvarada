import { getDb } from "./db";
import { gridCell } from "./grid";
import { getMergeData } from "./merge";
import type { MergeData } from "./merge";
import { getWeatherApiReading, isWeatherApiExhausted } from "./weatherapi";
import { DailyRateLimiter, envIntOr, type RateLimiterStats } from "./rateLimiter";
import { MERGE_MAX_AGE_HOURS } from "./constants";
import type { ForecastResult, ForecastSlot, NormalizedWeather, PressureTrend, RainSource, WeatherCache, WeatherSource } from "@/types";

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
// Atualização de 21/07/2026: Open-Meteo voltou a ser a camada 1 (principal)
// da estratégia de fallback em camadas -- WeatherAPI.com é a camada 2
// (reserva de emergência, ver lib/weatherapi.ts), configurada com um teto
// bem menor (3.000/dia por padrão) porque o plano Business dela só vale até
// 28/07/2026. 9.500/dia deixa ~500 de margem sobre a cota real (10.000/dia)
// pras chamadas extras de fetchForecastDisplay. Configurável via env.
const OPENMETEO_DAILY_LIMIT = envIntOr(process.env.OPENMETEO_DAILY_LIMIT, 9_500);
const openMeteoLimiter = new DailyRateLimiter(OPENMETEO_DAILY_LIMIT, "Open-Meteo");

export function getOpenMeteoLimiterStats(): RateLimiterStats {
  return openMeteoLimiter.getStats();
}

export function isOpenMeteoExhausted(): boolean {
  return openMeteoLimiter.isExhausted();
}

export class RateLimitExceededError extends Error {
  constructor() {
    super(`Limite interno de ${OPENMETEO_DAILY_LIMIT} chamadas/dia ao Open-Meteo atingido`);
    this.name = "RateLimitExceededError";
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

// Lacuna encontrada ao medir o efeito real das Opções 1+2+3 combinadas: a
// versão original de "sempre buscar quando o MERGE mostra chuva" refrescava
// a célula em TODO ciclo (a cada hora) enquanto a chuva durasse -- e é
// justamente esse balde (~514 células "chuvosas" agora, medido no Nordeste)
// que respondia por ~78% do consumo diário projetado (~12.336 das ~15.700
// chamadas/dia), deixando o total ~70% acima do orçamento mesmo depois das
// outras duas otimizações. rain_72h/rain_peak_3h -- o sinal de risco que
// mais importa -- já vêm do MERGE de graça em todo ciclo, chuva ou não; o
// que a Open-Meteo ainda contribui nesses casos é só vento/umidade/pressão/
// rain_1h, que não precisam de tanta frequência quanto o cron em si.
// Refrescar essas variáveis a cada 3h em vez de a cada ciclo (1h) corta o
// custo desse balde de 24x/dia pra 8x/dia sem atrasar em nada o sinal
// principal de risco.
const RAIN_ACTIVE_MAX_AGE_HOURS = 3;

export function mergeShowsSignificantRain(merge: MergeData | null): boolean {
  if (!merge) return true;
  return merge.rain_72h > SIGNIFICANT_RAIN_72H_MM || merge.rain_peak_3h > SIGNIFICANT_RAIN_PEAK_3H_MM;
}

// Contagem por camada usada pra popular GET /api/health (via
// scripts/sql/017_layered_fallback.sql, tabela cron_run_stats) -- só em
// memória do processo, resetada no início de cada execução do cron
// (app/api/cron/update/route.ts chama resetCycleStats() antes de
// processar as cidades e persiste getCycleStats() no banco ao final).
export interface CycleStats {
  openmeteo: number;
  weatherapi_fallback: number;
  cache_emergency: number;
  neutral_fallback: number;
}

let cycleStats: CycleStats = { openmeteo: 0, weatherapi_fallback: 0, cache_emergency: 0, neutral_fallback: 0 };

export function resetCycleStats(): void {
  cycleStats = { openmeteo: 0, weatherapi_fallback: 0, cache_emergency: 0, neutral_fallback: 0 };
}

export function getCycleStats(): CycleStats {
  return { ...cycleStats };
}

function incrementCycleStat(source: keyof CycleStats): void {
  cycleStats[source]++;
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

  // Backoff reduzido de 6 tentativas/62s de espera total (2s,4s,8s,16s,32s)
  // pra 2 tentativas/1s (achado do teste do Cron B de 23/07/2026: com o
  // Open-Meteo já limitando taxa de forma sustentada -- não uma rajada
  // momentânea --, o backoff longo original fazia CADA requisição gastar
  // até ~1min inteira só retentando antes de cair pro fallback da
  // WeatherAPI, que sempre respondia. 157 requisições nessas condições
  // levaram o lote inteiro do Cron B a 17min -- ver
  // docs/diagnostico_cron_arquitetura.md). Mantém uma retentativa curta
  // (não zero) pra absorver uma rajada breve de verdade, mas falha rápido
  // pro fallback quando o limite é persistente.
  for (let attempt = 0; attempt <= 1; attempt++) {
    if (openMeteoLimiter.isExhausted()) throw new RateLimitExceededError();
    openMeteoLimiter.increment();
    await throttleOpenMeteo();
    const res = await fetch(url);
    if (res.ok) return res.json();

    if (res.status === 429 && attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
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

// Versão cache-only de getWeatherForPoint -- usada pelo Cron A (recalcular
// scores), que precisa terminar em poucos minutos pra toda a base nacional e
// por isso nunca pode chamar Open-Meteo/WeatherAPI (essa é a causa raiz do
// incidente de rate-limit em cascata de 23/07/2026: rodar o cálculo de score
// e a busca de clima no mesmo ciclo faz TODA a base precisar de clima fresco
// de uma vez quando o cache expira nacionalmente). Se não houver nenhuma
// linha em weather_cache pra essa célula (cidade nova, ainda não visitada
// pelo Cron B), devolve valores neutros em vez de travar ou chamar API --
// a atualização de fato é responsabilidade exclusiva do Cron B
// (scripts/... ver app/api/cron/weather/route.ts).
export async function getWeatherFromCacheOnly(
  cityId: string,
  lat: number,
  lng: number,
  merge: MergeData | null
): Promise<NormalizedWeather> {
  const cell = gridCell(lat, lng);
  const cached = await getCachedWeather(cityId, cell.lat, cell.lng);

  if (cached) {
    return buildFromCacheAndMerge(cached, merge);
  }

  const rain72hFromMerge = merge ? merge.rain_72h : 0;
  const rainPeak3hFromMerge = merge ? merge.rain_peak_3h : 0;
  const rainSourceFromMerge: RainSource = merge ? "merge_cptec" : "openmeteo";

  return {
    rain_1h: 0,
    rain_3h: 0,
    rain_72h: rain72hFromMerge,
    rain_intensity: 0,
    rain_peak_3h: rainPeak3hFromMerge,
    rain_source: rainSourceFromMerge,
    wind_speed: 0,
    wind_direction: 0,
    humidity: 50,
    pressure: 1013,
    pressure_trend: "stable",
  };
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
  // grade ~10km) é consultado à parte do provedor de variáveis secundárias,
  // não dentro do mesmo try/catch — falhas independentes (cota/rate-limit
  // da WeatherAPI/Open-Meteo não têm nada a ver com o merge_cache estar
  // desatualizado, e vice-versa). rain_1h continua de fora do MERGE (que
  // tem ~3,5h de latência, impróprio pra "última hora") -- ver mais abaixo
  // pra rain_72h/rain_peak_3h.
  let merge: Awaited<ReturnType<typeof getMergeData>> = null;
  try {
    merge = await getMergeData(lat, lng);
  } catch (mergeErr) {
    console.warn(`[weather] Falha ao consultar merge_cache pra ${cityId}: ${(mergeErr as Error).message}`);
  }

  // Opções 2+3 (ver comentário acima de mergeShowsSignificantRain): o teto
  // de frescor do cache secundário (vento/umidade/pressão/rain_1h) varia
  // conforme o MERGE mostra chuva ou não na célula -- 24h parada, 3h em
  // chuva (ver RAIN_ACTIVE_MAX_AGE_HOURS). rain_72h/rain_peak_3h já vêm
  // atualizados pelo MERGE de graça em todo ciclo, chuva ou não.
  if (cached) {
    const cacheAgeHours = (Date.now() - new Date(cached.fetched_at).getTime()) / 3_600_000;
    const maxAgeHours = mergeShowsSignificantRain(merge) ? RAIN_ACTIVE_MAX_AGE_HOURS : SECONDARY_VARS_MAX_AGE_HOURS;
    if (cacheAgeHours <= maxAgeHours) {
      return buildFromCacheAndMerge(cached, merge);
    }
  }

  // Estratégia de fallback em camadas (21/07/2026): Open-Meteo volta a ser
  // a camada 1 -- cota real de 10.000/dia, maior que os 3.333/dia do plano
  // free da WeatherAPI (o Business contratado só vale até 28/07/2026).
  // Camada 1 (Open-Meteo) dá rain_72h/rain_peak_3h "de graça" na mesma
  // chamada (past_days=3), então a comparação completa de getBestRainData
  // com o MERGE roda normalmente aqui -- mesmo comportamento de antes da
  // migração pra WeatherAPI. Camada 2 (WeatherAPI) não tem uma janela de
  // 72h sem custo extra, então usa o MERGE direto (ou o cache, se o MERGE
  // também estiver indisponível) pra rain_72h/rain_peak_3h, igual ao que a
  // migração anterior já fazia. Camadas 3 (cache <24h) e 4 (neutro) nunca
  // deixam um bairro sem nenhum dado -- ver types/index.ts pros 4 valores
  // de weather_source.
  if (!openMeteoLimiter.isExhausted()) {
    let normalized: NormalizedWeather | null = null;
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

      normalized = {
        rain_1h: rain1h,
        rain_3h: rain3h,
        rain_72h: best.rain_72h,
        rain_intensity: rainIntensity,
        rain_peak_3h: best.rain_peak_3h,
        rain_source: best.rain_source,
        wind_speed: data.current.wind_speed_10m,
        wind_direction: data.current.wind_direction_10m,
        humidity: data.current.relative_humidity_2m,
        pressure: data.current.surface_pressure,
        pressure_trend: pressureTrend(data.current.surface_pressure, cached?.pressure ?? null),
      };
    } catch (openMeteoErr) {
      console.warn(
        `[weather] Open-Meteo falhou pra ${cityId} (${(openMeteoErr as Error).message}) — tentando WeatherAPI.com`
      );
    }

    // A leitura em si já foi obtida com sucesso -- uma falha ao GRAVAR no
    // cache (ex: erro transitório de conexão com o banco) não deve
    // descartar um dado bom e cair pra camada 2 à toa; só registra o aviso
    // e segue com o valor que já temos.
    if (normalized) {
      await saveWeatherCacheSafe(cityId, cell.lat, cell.lng, normalized, "openmeteo");
      incrementCycleStat("openmeteo");
      return normalized;
    }
  }

  // Camada 2: WeatherAPI.com (reserva de emergência)
  const rain72hFromMerge = merge ? merge.rain_72h : (cached?.rain_72h ?? 0);
  const rainPeak3hFromMerge = merge ? merge.rain_peak_3h : (cached?.rain_peak_3h ?? 0);
  const rainSourceFromMerge: RainSource = merge ? "merge_cptec" : (cached?.rain_source ?? "openmeteo");

  if (!isWeatherApiExhausted()) {
    let normalized: NormalizedWeather | null = null;
    try {
      const reading = await getWeatherApiReading(cell.lat, cell.lng);
      const rainIntensity = Math.max(reading.rain_1h, reading.rain_3h / 3);

      normalized = {
        rain_1h: reading.rain_1h,
        rain_3h: reading.rain_3h,
        rain_72h: rain72hFromMerge,
        rain_intensity: rainIntensity,
        rain_peak_3h: rainPeak3hFromMerge,
        rain_source: rainSourceFromMerge,
        wind_speed: reading.wind_speed,
        wind_direction: reading.wind_direction,
        humidity: reading.humidity,
        pressure: reading.pressure,
        pressure_trend: pressureTrend(reading.pressure, cached?.pressure ?? null),
      };
      console.info(`[weather] WeatherAPI.com usado como fallback (camada 2) pra ${cityId}`);
    } catch (weatherApiErr) {
      console.warn(
        `[weather] WeatherAPI.com também falhou pra ${cityId} (${(weatherApiErr as Error).message}) — usando cache`
      );
    }

    if (normalized) {
      await saveWeatherCacheSafe(cityId, cell.lat, cell.lng, normalized, "weatherapi_fallback");
      incrementCycleStat("weatherapi_fallback");
      return normalized;
    }
  }

  // Camada 3: cache existente (até 24h) -- último recurso antes do neutro.
  //
  // Deliberadamente NÃO grava uma nova linha em weather_cache aqui (desvio
  // do pedido original, que listava 'cache_emergency' como valor a
  // persistir). Motivo: gravar agora criaria um fetched_at novo em cima de
  // um dado que continua sendo o mesmo antigo -- na próxima execução do
  // cron, a checagem de TTL no topo desta função (24h parado / 3h chuvoso)
  // veria essa linha como "fresca" e pularia até 24h de tentativas novas às
  // camadas 1 e 2, mesmo que a Open-Meteo/WeatherAPI já tivessem voltado ao
  // ar. Sem gravar, a linha antiga continua envelhecendo de verdade, e o
  // próximo ciclo tenta as APIs reais de novo -- exatamente o que uma
  // "reserva de emergência" deveria fazer. O uso desta camada ainda fica
  // rastreável via GET /api/health (incrementCycleStat), só não via
  // weather_cache.weather_source.
  if (cached) {
    const cacheAgeHours = (Date.now() - new Date(cached.fetched_at).getTime()) / 3_600_000;
    if (cacheAgeHours <= 24) {
      console.warn(`[weather] Usando cache de emergência pra ${cityId} (${cached.fetched_at})`);
      incrementCycleStat("cache_emergency");
      return buildFromCacheAndMerge(cached, merge);
    }
  }

  // Camada 4: sem dado disponível de jeito nenhum (nem cache) -- nunca
  // deixar o app sem retorno, mas com um valor claramente identificável
  // como não-confiável (weather_source="neutral_fallback") em vez de
  // fingir que representa uma leitura real. Risco conhecido e aceito pelo
  // pedido: um "calmo" fabricado pode mascarar risco real numa célula nova
  // sem histórico durante uma queda simultânea das duas APIs -- cenário
  // raro (célula brand-new + Open-Meteo E WeatherAPI fora do ar ao mesmo
  // tempo), mas vale monitorar via GET /api/health se acontecer com
  // frequência maior que a esperada. Também não grava em weather_cache,
  // pelo mesmo motivo da camada 3 -- não existia linha nenhuma antes (é
  // por isso que chegamos até aqui), então gravar um valor fabricado
  // criaria uma "primeira leitura" falsa que o próximo ciclo trataria como
  // cache válido por até 24h.
  console.warn(`[weather] Nenhuma fonte disponível pra ${cityId} (nem cache) — retornando valores neutros`);
  incrementCycleStat("neutral_fallback");
  return {
    rain_1h: 0,
    rain_3h: 0,
    rain_72h: rain72hFromMerge,
    rain_intensity: 0,
    rain_peak_3h: rainPeak3hFromMerge,
    rain_source: rainSourceFromMerge,
    wind_speed: 0,
    wind_direction: 0,
    humidity: 50,
    pressure: 1013,
    pressure_trend: "stable",
  };
}

// Variante de saveWeatherCache que nunca lança -- usada nas camadas 1 e 2
// do fallback, onde a leitura em si já foi obtida com sucesso e uma falha
// de escrita no banco (conexão instável, constraint, etc.) não deveria
// jogar fora um dado bom nem cascatear pra próxima camada.
async function saveWeatherCacheSafe(
  cityId: string,
  lat: number,
  lng: number,
  data: NormalizedWeather,
  weatherSource: WeatherSource
): Promise<void> {
  try {
    await saveWeatherCache(cityId, lat, lng, data, weatherSource);
  } catch (err) {
    console.warn(
      `[weather] Falha ao gravar weather_cache pra ${cityId} (${(err as Error).message}) — ` +
        `o dado desta camada (${weatherSource}) ainda é usado neste ciclo, só não fica salvo pro próximo.`
    );
  }
}

export async function saveWeatherCache(
  cityId: string,
  lat: number,
  lng: number,
  data: NormalizedWeather,
  weatherSource: WeatherSource
): Promise<void> {
  const db = getDb();
  await db.query(
    `insert into weather_cache (city_id, lat, lng, rain_1h, rain_72h, rain_intensity, rain_peak_3h, rain_source, weather_source, wind_speed, wind_direction, humidity, pressure)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      cityId,
      lat,
      lng,
      data.rain_1h,
      data.rain_72h,
      data.rain_intensity,
      data.rain_peak_3h,
      data.rain_source,
      weatherSource,
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
