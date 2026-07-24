import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readFromB2, getRiskScoresKey } from "@/lib/b2";
import { isValidBrazilState } from "@/lib/geo";

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
  const state = searchParams.get("state");
  const date = searchParams.get("date");
  const neighborhoodId = searchParams.get("neighborhood_id");

  if (!state || !date) {
    return NextResponse.json({ error: "Parâmetros obrigatórios: state e date" }, { status: 400 });
  }
  if (!isValidBrazilState(state)) {
    return NextResponse.json({ error: "state deve ser uma UF válida (2 letras maiúsculas)" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date deve estar no formato YYYY-MM-DD" }, { status: 400 });
  }

  const cutoff = new Date(Date.now() - ARCHIVE_CUTOFF_HOURS * 3_600_000);
  const requestedDate = new Date(`${date}T23:59:59Z`);
  const isRecent = requestedDate > cutoff;

  let data: HistoryRow[] | null = null;
  const source = isRecent ? "supabase" : "b2";

  if (isRecent) {
    const db = getDb();
    const { rows } = await db.query<HistoryRow>(
      `select rs.neighborhood_id, rs.score, rs.level, rs.rain_1h, rs.rain_72h, rs.rain_peak_3h,
              rs.tide_level, rs.auto_critical, rs.auto_critical_reason, rs.calculated_at,
              n.name as neighborhood_name, n.centroid_lat, n.centroid_lng
       from risk_scores rs
       join neighborhoods n on n.id = rs.neighborhood_id
       join cities c on c.id = n.city_id
       where c.state = $1
         and rs.calculated_at >= $2::date
         and rs.calculated_at < ($2::date + interval '1 day')
       order by rs.calculated_at asc
       limit $3`,
      [state, date, MAX_HISTORY_ROWS]
    );
    data = rows;
  } else {
    data = await readFromB2<HistoryRow[]>(getRiskScoresKey(date, state));
  }

  if (!data) {
    return NextResponse.json({ error: "Dados não encontrados para este período" }, { status: 404 });
  }

  const filtered = neighborhoodId ? data.filter((d) => d.neighborhood_id === neighborhoodId) : data;

  return NextResponse.json({ data: filtered, source });
}
