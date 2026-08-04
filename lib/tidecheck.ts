// Integração com a API do TideCheck (tidecheck.com) -- maré em tempo real.
//
// Cota gratuita: 50 requisições/dia. Com 115 cidades costeiras cadastradas
// (ver cities.tide_code), buscar o nível atual a cada ciclo estouraria a
// cota de longe. Em vez disso, cada busca traz a série prevista de ~10
// dias inteira (`timeSeries`) e ela fica em cache até perto do fim dessa
// janela -- o nível "agora" é sempre recalculado a partir da série já
// salva (ver computeTideLevelFromSeries), sem chamada de rede nenhuma.
// Isso é o que faz a integração caber na cota -- ver scripts/sql/038 e
// app/api/cron/tide/route.ts.

const TIDECHECK_API_URL = "https://tidecheck.com/api";
const SEARCH_RADIUS_KM = 50; // raio máximo pra considerar uma estação válida

export type TideStationType = "uhslc" | "fes2022";

export interface TideStation {
  id: string;
  name: string;
  distanceKm: number;
  type: TideStationType;
}

export interface TideSeries {
  stationId: string;
  stationType: TideStationType;
  heightMin: number;
  heightMax: number;
  timeSeries: { time: string; height: number }[];
  seriesEndsAt: string;
}

function apiKey(): string {
  const key = process.env.TIDECHECK_API_KEY;
  if (!key) throw new Error("TIDECHECK_API_KEY não configurada");
  return key;
}

function stationType(id: string): TideStationType {
  // Estações reais da rede UHSLC têm esse sufixo no id (ex:
  // "recife_uscgs-712a-bra-uhslc_rq"); tudo mais no catálogo do TideCheck
  // é ponto do modelo global FES2022 -- confirmado inspecionando a API
  // diretamente (o campo `type` da própria API não diferencia os dois,
  // sempre volta "reference" pros dois casos).
  return id.includes("-uhslc_") ? "uhslc" : "fes2022";
}

// Acha a melhor estação pra uma coordenada -- prefere UHSLC (medição real)
// sobre FES2022 (modelo), dentro do raio de busca.
export async function findBestStation(lat: number, lng: number): Promise<TideStation | null> {
  const res = await fetch(
    `${TIDECHECK_API_URL}/stations/nearest?lat=${lat}&lng=${lng}&limit=10`,
    { headers: { "X-API-Key": apiKey() } }
  );
  if (!res.ok) {
    console.warn(`[tidecheck] findBestStation falhou (${res.status})`);
    return null;
  }

  const data = await res.json();
  const stations: any[] = Array.isArray(data) ? data : data.stations ?? [];
  const nearby = stations.filter((s) => (s.distanceKm ?? s.distance_km ?? Infinity) <= SEARCH_RADIUS_KM);
  if (nearby.length === 0) return null;

  const uhslc = nearby.find((s) => stationType(s.id) === "uhslc");
  const best = uhslc ?? nearby[0];

  return {
    id: best.id,
    name: best.name,
    distanceKm: best.distanceKm ?? best.distance_km ?? 0,
    type: stationType(best.id),
  };
}

// Busca a série de maré prevista (~10 dias) de uma estação -- 1 requisição,
// reaproveitada por até ~9 dias antes de precisar buscar de novo.
export async function fetchTideSeries(stationId: string): Promise<TideSeries | null> {
  const encodedId = encodeURIComponent(stationId);
  const res = await fetch(`${TIDECHECK_API_URL}/station/${encodedId}/tides`, {
    headers: { "X-API-Key": apiKey() },
  });
  if (!res.ok) {
    console.warn(`[tidecheck] fetchTideSeries falhou pra ${stationId} (${res.status})`);
    return null;
  }

  const data = await res.json();
  const timeSeries: { time: string; height: number }[] = data.timeSeries ?? [];
  const extremes: { time: string; height: number; type: string }[] = data.extremes ?? [];

  if (timeSeries.length === 0 || extremes.length === 0) {
    console.warn(`[tidecheck] resposta sem timeSeries/extremes pra ${stationId}`);
    return null;
  }

  const heights = extremes.map((e) => e.height);
  const heightMin = Math.min(...heights);
  const heightMax = Math.max(...heights);
  const seriesEndsAt = timeSeries[timeSeries.length - 1].time;

  return {
    stationId,
    stationType: stationType(stationId),
    heightMin,
    heightMax,
    timeSeries,
    seriesEndsAt,
  };
}

// Interpola o nível de maré (0-1) pro instante `at` a partir de uma série
// já em cache -- nenhuma chamada de rede. Normalização aprovada: usa o
// min/max das marés altas/baixas (extremes) da própria janela de ~10 dias
// como referência, já que a API não expõe HAT/MHWS (referência teórica de
// longo prazo) -- só o que vem na janela retornada.
export function computeTideLevelFromSeries(
  timeSeries: { time: string; height: number }[],
  heightMin: number,
  heightMax: number,
  at: Date = new Date()
): { heightM: number; tideLevel: number } | null {
  if (timeSeries.length === 0) return null;

  const target = at.getTime();
  const closest = timeSeries.reduce((best, point) => {
    const diff = Math.abs(new Date(point.time).getTime() - target);
    const bestDiff = Math.abs(new Date(best.time).getTime() - target);
    return diff < bestDiff ? point : best;
  });

  const range = heightMax - heightMin;
  const tideLevel = range === 0 ? 0.5 : Math.max(0, Math.min(1, (closest.height - heightMin) / range));

  return { heightM: closest.height, tideLevel: Math.round(tideLevel * 1000) / 1000 };
}
