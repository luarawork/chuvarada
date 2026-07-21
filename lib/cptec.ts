import * as cheerio from "cheerio";
import { getDb } from "./db";
import type { TideCacheData, TideDay, TideResult } from "@/types";

const TIDE_CODES: Record<string, string> = {
  Salvador: "40140",
  Recife: "30645",
  Natal: "30461",
  Fortaleza: "30340",
  Maceió: "30725",
  Aracaju: "30825",
  "João Pessoa": "30540",
  "São Luís": "30120",
};

function buildUrl(tideCode: string, month: number, year: number): string {
  // O site do CPTEC espera o ano com 2 dígitos (ex: 26, não 2026) — mandar
  // 4 dígitos faz o template deles concatenar errado ("20" + "2026") e
  // sempre cair no fallback de mês vazio.
  const shortYear = String(year).slice(-2);
  return `http://ondas.cptec.inpe.br/~rondas/mares/index.php?cod=${tideCode}&mes=${month}&ano=${shortYear}`;
}

// O CPTEC publica a tábua de marés em uma tabela HTML por dia/horário/altura.
// A estrutura exata do markup pode mudar; este parser assume uma tabela com
// colunas "Dia", "Hora" e "Altura (m)" repetidas para cada evento de maré do dia.
export async function fetchTideTable(
  cityId: string,
  tideCode: string,
  month: number,
  year: number
): Promise<TideCacheData> {
  const url = buildUrl(tideCode, month, year);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CPTEC falhou: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const days: TideDay[] = [];
  let min = Infinity;
  let max = -Infinity;

  $("table tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, cell) => $(cell).text().trim())
      .get();

    if (cells.length < 3) return;

    const [date, hour, heightRaw] = cells;
    const height = parseFloat(heightRaw.replace(",", "."));
    if (!date || !hour || Number.isNaN(height)) return;

    min = Math.min(min, height);
    max = Math.max(max, height);

    let dayEntry = days.find((d) => d.date === date);
    if (!dayEntry) {
      dayEntry = { date, tides: [] };
      days.push(dayEntry);
    }
    dayEntry.tides.push({ hour, level: height });
  });

  const tideData: TideCacheData = {
    days,
    max_level: Number.isFinite(max) ? max : 1,
    min_level: Number.isFinite(min) ? min : 0,
  };

  await saveTideCache(cityId, month, year, tideData);
  return tideData;
}

async function saveTideCache(
  cityId: string,
  month: number,
  year: number,
  data: TideCacheData
): Promise<void> {
  const db = getDb();
  await db.query(
    `insert into tide_cache (city_id, month, year, data, cached_at)
     values ($1, $2, $3, $4, now())
     on conflict (city_id, month, year)
     do update set data = excluded.data, cached_at = excluded.cached_at`,
    [cityId, month, year, JSON.stringify(data)]
  );
}

interface CachedTideRow {
  data: TideCacheData;
  cached_at: string;
}

export async function getCachedTide(cityId: string): Promise<CachedTideRow | null> {
  const now = new Date();
  const db = getDb();
  const { rows } = await db.query(
    `select data, cached_at from tide_cache where city_id = $1 and month = $2 and year = $3`,
    [cityId, now.getMonth() + 1, now.getFullYear()]
  );
  return rows[0] ?? null;
}

// Retorna o nível de maré atual normalizado (0.0 a 1.0) comparando a hora atual
// com a curva de máximos/mínimos do mês em cache.
export async function getCurrentTideLevel(
  cityId: string,
  tideCode: string | null
): Promise<TideResult> {
  if (!tideCode) {
    return { level: 0.5, estimated: true, note: "sem dado de maré", cached_at: null };
  }

  const cachedRow = await getCachedTide(cityId);
  let cache = cachedRow?.data ?? null;
  let cachedAt = cachedRow?.cached_at ?? null;

  // Uma linha de cache com 0 dias significa que a última tentativa não
  // encontrou tábua publicada para o mês (ex: mês futuro que o CPTEC ainda
  // não divulgou) — trata como cache miss e tenta buscar de novo, em vez de
  // ficar preso nesse estado até o mês virar.
  if (!cache || cache.days.length === 0) {
    try {
      const now = new Date();
      cache = await fetchTideTable(cityId, tideCode, now.getMonth() + 1, now.getFullYear());
      cachedAt = now.toISOString(); // acabou de buscar/gravar, então é fresco agora
    } catch {
      return { level: 0.5, estimated: true, note: "sem dado de maré", cached_at: null };
    }
  }

  if (!cache || cache.days.length === 0) {
    return { level: 0.5, estimated: true, note: "sem dado de maré", cached_at: null };
  }

  const now = new Date();
  const todayStr = formatDate(now);
  const today = cache.days.find((d) => d.date === todayStr) ?? cache.days[cache.days.length - 1];

  const closest = closestTide(today, now);
  if (!closest) {
    return { level: 0.5, estimated: true, note: "dado estimado", cached_at: cachedAt };
  }

  const range = cache.max_level - cache.min_level || 1;
  const normalized = (closest.level - cache.min_level) / range;
  return { level: clamp01(normalized), estimated: false, cached_at: cachedAt };
}

function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function closestTide(day: TideDay, now: Date) {
  if (!day.tides.length) return null;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return day.tides.reduce((closest, t) => {
    const [h, m] = t.hour.split(":").map(Number);
    const diff = Math.abs(h * 60 + m - nowMinutes);
    const closestDiff = closest
      ? Math.abs(
          Number(closest.hour.split(":")[0]) * 60 +
            Number(closest.hour.split(":")[1]) -
            nowMinutes
        )
      : Infinity;
    return diff < closestDiff ? t : closest;
  }, day.tides[0]);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function getTideCodeByCityName(name: string): string | undefined {
  return TIDE_CODES[name];
}
