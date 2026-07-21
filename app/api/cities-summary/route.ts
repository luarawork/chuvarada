import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Agregado por cidade (pior nível, score máximo, contagem de críticos/
// atenção) pro modo "pontos" do mapa no zoom-out -- consulta trivial e
// indexada contra city_risk_summary (tabela real mantida pelo cron, ver
// migração 022), nunca recalcula nada na hora.
const MAX_CITIES_PER_REQUEST = 5000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const db = getDb();

  const north = parseFloat(searchParams.get("north") ?? "");
  const south = parseFloat(searchParams.get("south") ?? "");
  const east = parseFloat(searchParams.get("east") ?? "");
  const west = parseFloat(searchParams.get("west") ?? "");

  if ([north, south, east, west].some((v) => Number.isNaN(v))) {
    return NextResponse.json(
      { error: "Parâmetros north/south/east/west são obrigatórios e devem ser numéricos" },
      { status: 400 }
    );
  }

  const { rows } = await db.query(
    `select city_id, name, state, lat, lng, data_level, max_score, worst_level, critical_count, attention_count, last_updated
     from city_risk_summary
     where lat between $1 and $2 and lng between $3 and $4
     limit $5`,
    [south, north, west, east, MAX_CITIES_PER_REQUEST]
  );

  return NextResponse.json({ cities: rows });
}
