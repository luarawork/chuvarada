import { getDb } from "./db";

// Grade nativa do produto MERGE/CPTEC confirmada no .ctl que acompanha cada
// arquivo (xdef 1001 linear -120.05 0.1 / ydef 924 linear -60.05 0.1) — ver
// scripts/proposta_integracao_merge_cptec.md e scripts/fetch_merge_cptec.py,
// que é quem efetivamente baixa/processa os GRIB2 e popula merge_cache
// (GRIB2 não tem parser maduro em Node/TS; esse processamento roda separado
// do cron, como script Python).
const MERGE_GRID_STEP = 0.1;

// Origem confirmada no .ctl que acompanha os GRIB2 (xdef 1001 linear -120.05
// 0.1 / ydef 924 linear -60.05 0.1) — os centros de célula ficam em ",X5"
// (-5.75, -5.85, ...), não em múltiplos redondos de 0.1 (-5.7, -5.8, ...).
// Arredondar direto pro múltiplo de 0.1 mais próximo (sem levar a origem em
// conta) nunca bate com nenhuma célula real gravada por
// scripts/fetch_merge_cptec.py — precisa da mesma fórmula usada lá
// (canonical_grid) pros dois lados baterem.
const MERGE_GRID_ORIGIN_LON = -120.05;
const MERGE_GRID_ORIGIN_LAT = -60.05;

// Acima disso, o dado em merge_cache é considerado velho demais pra
// representar "agora" — melhor cair pro fallback da Open-Meteo do que usar
// um MERGE de meio dia atrás sem sinalizar (ver lib/weather.ts).
const MERGE_MAX_AGE_HOURS = 6;

export interface MergeData {
  rain_72h: number;
  rain_peak_3h: number;
  source: "merge";
  fetched_at: string;
}

function snapToGrid(value: number, origin: number): number {
  const snapped = origin + Math.round((value - origin) / MERGE_GRID_STEP) * MERGE_GRID_STEP;
  return Math.round(snapped * 10000) / 10000;
}

// Acima disso, um lock de escrita em system_locks é considerado travado
// (processo morreu no meio sem liberar) e passa a ser ignorado -- ver
// scripts/fetch_merge_cptec.py, que grava/apaga esse lock.
const LOCK_MAX_AGE_MINUTES = 30;

// Evita 1 query em system_locks por célula consultada (getMergeData roda
// uma vez por bairro/grupo de bairros a cada ciclo de cron -- na expansão
// nacional isso chegaria a milhares de chamadas por hora). O lock só muda
// de estado umas poucas vezes por hora, então um cache curto em memória do
// processo já elimina quase toda essa repetição sem atrasar a detecção.
const LOCK_CHECK_CACHE_MS = 30_000;
let lockCache: { checkedAt: number; locked: boolean } | null = null;

// merge_cache está sendo escrito agora (fetch_merge_cptec.py rodando) --
// ver comentário acima de getMergeData sobre por que isso importa: ler no
// meio de um lote de ~31.500 upserts mistura célula já atualizada com
// célula ainda não tocada nessa mesma rodada (foi exatamente isso que
// causou o incidente de Natal, 21/07/2026).
async function isMergeCacheWriting(): Promise<boolean> {
  if (lockCache && Date.now() - lockCache.checkedAt < LOCK_CHECK_CACHE_MS) {
    return lockCache.locked;
  }

  const db = getDb();
  const { rows } = await db.query(`select locked_at from system_locks where key = 'merge_cache_write'`);
  const lockRow = rows[0];
  const locked = !!lockRow && (Date.now() - new Date(lockRow.locked_at).getTime()) / 60000 < LOCK_MAX_AGE_MINUTES;

  lockCache = { checkedAt: Date.now(), locked };
  return locked;
}

// Busca o dado de precipitação mais recente do MERGE/CPTEC pra célula de
// grade (~10km) mais próxima do ponto pedido. Retorna null se não houver
// nenhuma leitura, se a mais recente já estiver velha demais (>6h), ou se
// merge_cache estiver sendo escrito agora (lock ativo) -- nesses casos
// quem chama deve cair pro fallback da Open-Meteo.
export async function getMergeData(lat: number, lng: number): Promise<MergeData | null> {
  if (await isMergeCacheWriting()) return null;

  const gridLat = snapToGrid(lat, MERGE_GRID_ORIGIN_LAT);
  const gridLng = snapToGrid(lng, MERGE_GRID_ORIGIN_LON);

  const db = getDb();
  const { rows } = await db.query(
    `select rain_72h, rain_peak_3h, fetched_at
     from merge_cache
     where grid_lat = $1 and grid_lng = $2
     order by data_date desc, fetched_at desc
     limit 1`,
    [gridLat, gridLng]
  );

  const cached = rows[0];
  if (!cached) return null;

  const ageHours = (Date.now() - new Date(cached.fetched_at).getTime()) / 3_600_000;
  if (ageHours > MERGE_MAX_AGE_HOURS) return null;

  return {
    rain_72h: cached.rain_72h,
    rain_peak_3h: cached.rain_peak_3h,
    source: "merge",
    fetched_at: cached.fetched_at,
  };
}
