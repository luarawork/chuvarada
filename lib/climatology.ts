// Desvio da precipitação atual em relação à média histórica do mesmo
// período do ano, pra dar contexto ao "chuva 72h" isolado no DetailPanel
// (ex: 60mm pode ser normal em janeiro numa cidade chuvosa e extremo em
// agosto numa cidade seca -- o valor bruto sozinho não comunica isso).
// Fonte: Open-Meteo Historical Weather API (archive-api.open-meteo.com),
// gratuita e sem chave, mesma família de API já usada em lib/weather.ts.

export interface ClimatologyData {
  mean_72h: number; // média histórica de rain_72h para o período
  stddev_72h: number; // desvio padrão
  years_analyzed: number; // quantos anos de dados
  period: string; // ex: "agosto"
}

export interface DeviationResult {
  deviation_pct: number; // % acima/abaixo da média (pode ser negativo)
  label: string; // ex: "156% acima da média histórica para agosto"
  significance: "low" | "moderate" | "high" | "extreme";
  climatology: ClimatologyData;
}

interface OpenMeteoArchiveResponse {
  daily: {
    time: string[];
    precipitation_sum: (number | null)[];
  };
}

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// Busca os últimos 30 anos de precipitação diária pra lat/lng e calcula a
// média/desvio padrão do acumulado de 3 dias (mesma janela de rain_72h)
// pro período do ano de referenceDate (±1 dia, [-2,-1,0] em relação ao dia).
export async function getHistoricalPrecipitation(
  lat: number,
  lng: number,
  referenceDate: Date = new Date()
): Promise<ClimatologyData | null> {
  const month = referenceDate.getMonth() + 1;
  const day = referenceDate.getDate();

  const currentYear = referenceDate.getFullYear();
  const startYear = currentYear - 30;

  // Janela [startYear-01-01, currentYear-1-12-31] -- 30 anos completos
  // anteriores ao ano corrente, que ainda pode estar incompleto.
  const startDate = `${startYear}-01-01`;
  const endDate = `${currentYear - 1}-12-31`;

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lng.toString());
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("daily", "precipitation_sum");
  url.searchParams.set("timezone", "America/Sao_Paulo");

  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 86400 }, // cache por 24h -- dado histórico não muda
    });

    if (!res.ok) return null;
    const data = (await res.json()) as OpenMeteoArchiveResponse;

    const times = data.daily.time;
    const precip = data.daily.precipitation_sum;

    // Pra cada ano, soma a precipitação dos 3 dias correspondentes ao
    // período atual (mesmo offset de dias usado por rain_72h).
    const yearly72h: number[] = [];

    for (let year = startYear; year < currentYear; year++) {
      const targetDates = [-2, -1, 0].map((offset) => {
        const d = new Date(year, month - 1, day + offset);
        return d.toISOString().split("T")[0];
      });

      const dailyPrecip = targetDates.map((date) => {
        const idx = times.indexOf(date);
        return idx >= 0 ? precip[idx] ?? 0 : 0;
      });

      yearly72h.push(dailyPrecip.reduce((a, b) => a + b, 0));
    }

    const mean = yearly72h.reduce((a, b) => a + b, 0) / yearly72h.length;
    const variance = yearly72h.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / yearly72h.length;
    const stddev = Math.sqrt(variance);

    return {
      mean_72h: Math.round(mean * 10) / 10,
      stddev_72h: Math.round(stddev * 10) / 10,
      years_analyzed: yearly72h.length,
      period: MONTH_NAMES[month - 1],
    };
  } catch {
    return null;
  }
}

// Classifica o desvio via z-score (quantos desvios padrão do histórico o
// valor atual está) -- mais robusto que só a % de desvio, que sozinha não
// diferencia "10% acima da média" numa cidade de chuva estável (pode ser
// significativo) de "10% acima" numa cidade de chuva errática (ruído).
export function calculateDeviation(current_72h: number, climatology: ClimatologyData): DeviationResult {
  if (climatology.mean_72h === 0) {
    return {
      deviation_pct: 0,
      label: "Sem referência histórica disponível",
      significance: "low",
      climatology,
    };
  }

  const deviation_pct = Math.round(((current_72h - climatology.mean_72h) / climatology.mean_72h) * 100);

  const zScore =
    climatology.stddev_72h > 0 ? (current_72h - climatology.mean_72h) / climatology.stddev_72h : 0;

  const significance: DeviationResult["significance"] =
    Math.abs(zScore) >= 3 ? "extreme" : Math.abs(zScore) >= 2 ? "high" : Math.abs(zScore) >= 1 ? "moderate" : "low";

  let label: string;
  if (Math.abs(deviation_pct) < 10) {
    label = `Dentro da média histórica para ${climatology.period}`;
  } else if (deviation_pct > 0) {
    label = `${deviation_pct}% acima da média histórica para ${climatology.period}`;
  } else {
    label = `${Math.abs(deviation_pct)}% abaixo da média histórica para ${climatology.period}`;
  }

  return { deviation_pct, label, significance, climatology };
}
