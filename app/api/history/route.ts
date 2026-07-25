import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readFromB2, getRiskScoresKey } from "@/lib/b2";
import { resolveStatesFilter } from "@/lib/geo";
import { handleApiError } from "@/lib/apiError";

// Consulta histórico de risk_scores -- dados com menos de 48h ainda estão
// no Supabase (mesmo corte usado por scripts/archive_to_b2.ts pra decidir o
// que arquivar); além disso, busca no Backblaze B2.
//
// GET /api/history?state=RN&date=2026-07-21&neighborhood_id=XXX
const ARCHIVE_CUTOFF_HOURS = 24 * 2;

// Corrige achado médio M8 da auditoria de segurança: a query pro caminho
// "recente" (Supabase) não tinha limite nenhum -- um estado grande num dia
// cheio já passou de 14 mil linhas num único request nesta mesma sessão de
// auditoria. O teto aqui é generoso o bastante pra nunca cortar um
// dia/estado real (maior valor observado até agora bem abaixo disso),
// só existe como salvaguarda contra um caso patológico.
const MAX_HISTORY_ROWS = 50_000;

interface HistoryRow {
  neighborhood_id: string;
  score: number;
  level: string;
  rain_1h: number;
  rain_72h: number;
  rain_peak_3h: number;
  tide_level: number;
  auto_critical: boolean;
  auto_critical_reason: string | null;
  calculated_at: string;
  neighborhood_name?: string;
  centroid_lat?: number | null;
  centroid_lng?: number | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // ?region= aceita UF (RN), "BR" (país inteiro) ou uma chave de
  // BRAZIL_REGIONS (norte/nordeste/sudeste/sul/centro-oeste) -- ?state=
  // continua funcionando como fallback pro contrato antigo de UF única.
  const region = searchParams.get("region") ?? searchParams.get("state");
  const date = searchParams.get("date");
  const neighborhoodId = searchParams.get("neighborhood_id");

  const states = resolveStatesFilter(region);
  if (!states) {
    return NextResponse.json(
      { error: "Parâmetro region/state inválido -- use uma UF, 'BR', ou uma região (norte/nordeste/sudeste/sul/centro-oeste)" },
      { status: 400 }
    );
  }
  if (!date) {
    return NextResponse.json({ error: "Parâmetro obrigatório: date" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date deve estar no formato YYYY-MM-DD" }, { status: 400 });
  }

  const cutoff = new Date(Date.now() - ARCHIVE_CUTOFF_HOURS * 3_600_000);
  const requestedDate = new Date(`${date}T23:59:59Z`);
  const isRecent = requestedDate > cutoff;
  const source = isRecent ? "supabase" : "b2";

  try {
    let data: HistoryRow[] | null = null;

    if (isRecent) {
      // Um único estado ou o país inteiro custam a mesma query -- states =
      // ANY($1) deixa o Postgres decidir o plano, em vez de N queries
      // separadas (uma por UF) que a expansão pra região/Brasil exigiria.
      const db = getDb();
      const { rows } = await db.query<HistoryRow>(
        `select rs.neighborhood_id, rs.score, rs.level, rs.rain_1h, rs.rain_72h, rs.rain_peak_3h,
                rs.tide_level, rs.auto_critical, rs.auto_critical_reason, rs.calculated_at,
                n.name as neighborhood_name, n.centroid_lat, n.centroid_lng
         from risk_scores rs
         join neighborhoods n on n.id = rs.neighborhood_id
         join cities c on c.id = n.city_id
         where c.state = any($1::text[])
           and rs.calculated_at >= $2::date
           and rs.calculated_at < ($2::date + interval '1 day')
         order by rs.calculated_at asc
         limit $3`,
        [states, date, MAX_HISTORY_ROWS]
      );
      data = rows;
    } else {
      // B2 arquiva um arquivo por UF/data (ver scripts/archive_to_b2.ts) --
      // não tem como agregar região/Brasil numa leitura só, precisa buscar
      // cada UF e combinar. Estados sem arquivo pro dia (readFromB2 volta
      // null) são ignorados -- só vira 404 se NENHUM estado tiver dado.
      const perState = await Promise.all(
        states.map((s) => readFromB2<HistoryRow[]>(getRiskScoresKey(date, s)))
      );
      const found = perState.filter((rows): rows is HistoryRow[] => rows !== null);
      data = found.length > 0 ? found.flat() : null;
    }

    if (!data) {
      return NextResponse.json({ error: "Dados não encontrados para este período" }, { status: 404 });
    }

    const filtered = neighborhoodId ? data.filter((d) => d.neighborhood_id === neighborhoodId) : data;

    return NextResponse.json({ data: filtered, source });
  } catch (err) {
    return handleApiError(err, "api/history");
  }
}
