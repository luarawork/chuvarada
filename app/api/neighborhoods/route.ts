import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Neighborhood, RiskScore } from "@/types";

// Teto por requisição -- viewport normal (1 cidade, mesmo grande como São
// Paulo) fica bem abaixo disso. Existe só como salvaguarda contra um bbox
// de zoom-out cobrindo o Brasil inteiro (24.556 bairros de uma vez
// derrotaria o próprio propósito de carregar por viewport).
const MAX_NEIGHBORHOODS_PER_REQUEST = 2000;

// Carrega bairros dentro do bbox visível do mapa, com o score mais recente
// já embutido -- substitui o antigo `supabase.from("neighborhoods").select("*")`
// sem filtro, que sempre batia no limite de 1000 linhas do PostgREST (só
// ~4% do Brasil chegava a aparecer, nenhum bairro de São Paulo entre eles).
// Ver diagnóstico da investigação "São Paulo não aparece no mapa".
// geometry_simplified (Douglas-Peucker, tolerância 0.001°/~100m -- ver
// scripts/backfill_geometry_simplified.js) em vez da geometria original:
// medido que geometria era 44-84% do payload de resposta dependendo do
// zoom, e a versão simplificada corta isso em ~37% sem mudar o formato
// reconhecível do bairro. `coalesce` cobre a raríssima linha sem versão
// simplificada ainda (ex.: insert manual fora dos scripts de upload).
const SELECT_COLUMNS = `
  n.id, n.city_id, n.name, n.name_source,
  coalesce(n.geometry_simplified, n.geometry) as geometry,
  n.terrain_slope, n.hydro_proximity, n.is_coastal, n.created_at,
  rs.id as score_id, rs.score, rs.level, rs.rain_1h, rs.rain_72h,
  rs.rain_intensity, rs.rain_peak_3h, rs.rain_source, rs.tide_level,
  rs.wind_speed, rs.wind_direction, rs.humidity, rs.pressure,
  rs.auto_critical, rs.auto_critical_reason, rs.calculated_at
`;

// LATERAL + LIMIT 1 (via índice risk_scores_neighborhood_time) em vez de
// `join latest_risk_scores` -- confirmado via EXPLAIN ANALYZE que a view
// (distinct on sem WHERE) força o planner a fazer um Merge Join que
// des-duplica risk_scores INTEIRA (todos os ~187 mil registros de todo o
// Brasil, ~220ms/188 mil buffer hits) mesmo pra devolver só ~124 bairros de
// um viewport. O LATERAL vira um Nested Loop que busca só o score mais
// recente DE CADA bairro já filtrado pelo bbox (~7ms/620 buffer hits pro
// mesmo resultado) -- ~28x mais rápido, mesmo índice, mesmo dado.
const LATEST_SCORE_LATERAL = `
  left join lateral (
    select * from risk_scores r
    where r.neighborhood_id = n.id
    order by r.calculated_at desc
    limit 1
  ) rs on true
`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const db = getDb();

  // Lista (pequena, tipicamente vazia) de cidades sem NENHUM bairro ainda --
  // usado só pelo EmptyStateLayer pra desenhar o placeholder "cobertura em
  // expansão". Precisa ser global, não pode inferir isso a partir de
  // `neighborhoods` (agora só o viewport atual) -- toda cidade fora do
  // viewport pareceria "vazia" incorretamente.
  if (searchParams.get("emptyCities") === "true") {
    const { rows } = await db.query(
      `select c.id
       from cities c
       left join neighborhoods n on n.city_id = c.id
       where c.active = true and n.id is null`
    );
    return NextResponse.json({ cityIds: rows.map((r) => r.id) });
  }

  // Lookup direto por id, sem passar pelo filtro de bbox -- usado quando o
  // app abre direto num bairro específico (link de favorito, ?bairro=<id>)
  // que pode estar fora do viewport inicial do mapa (ex: favorito em São
  // Paulo com o mapa abrindo no Nordeste). Ver app/page.tsx.
  const id = searchParams.get("id");
  if (id) {
    const { rows } = await db.query(
      `select ${SELECT_COLUMNS}
       from neighborhoods n
       ${LATEST_SCORE_LATERAL}
       where n.id = $1`,
      [id]
    );
    return NextResponse.json(buildResponse(rows));
  }

  const north = parseFloat(searchParams.get("north") ?? "");
  const south = parseFloat(searchParams.get("south") ?? "");
  const east = parseFloat(searchParams.get("east") ?? "");
  const west = parseFloat(searchParams.get("west") ?? "");

  if ([north, south, east, west].some((v) => Number.isNaN(v))) {
    return NextResponse.json(
      { error: "Parâmetros north/south/east/west são obrigatórios e devem ser numéricos (ou use ?id=)" },
      { status: 400 }
    );
  }

  const { rows } = await db.query(
    `select ${SELECT_COLUMNS}
     from neighborhoods n
     ${LATEST_SCORE_LATERAL}
     where n.centroid_lat between $1 and $2
       and n.centroid_lng between $3 and $4
     limit $5`,
    [south, north, west, east, MAX_NEIGHBORHOODS_PER_REQUEST + 1]
  );

  return NextResponse.json(buildResponse(rows));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildResponse(rows: any[]) {
  const truncated = rows.length > MAX_NEIGHBORHOODS_PER_REQUEST;
  const page = truncated ? rows.slice(0, MAX_NEIGHBORHOODS_PER_REQUEST) : rows;

  const neighborhoods: Neighborhood[] = page.map((r) => ({
    id: r.id,
    city_id: r.city_id,
    name: r.name,
    name_source: r.name_source,
    geometry: typeof r.geometry === "string" ? JSON.parse(r.geometry) : r.geometry,
    terrain_slope: r.terrain_slope,
    hydro_proximity: r.hydro_proximity,
    is_coastal: r.is_coastal,
    created_at: r.created_at,
  }));

  const scores: Record<string, RiskScore> = {};
  for (const r of page) {
    if (!r.score_id) continue;
    scores[r.id] = {
      id: r.score_id,
      neighborhood_id: r.id,
      score: r.score,
      level: r.level,
      rain_1h: r.rain_1h,
      rain_72h: r.rain_72h,
      rain_intensity: r.rain_intensity,
      rain_peak_3h: r.rain_peak_3h,
      rain_source: r.rain_source,
      terrain_slope: r.terrain_slope,
      hydro_proximity: r.hydro_proximity,
      tide_level: r.tide_level,
      wind_speed: r.wind_speed,
      wind_direction: r.wind_direction,
      humidity: r.humidity,
      pressure: r.pressure,
      auto_critical: r.auto_critical,
      auto_critical_reason: r.auto_critical_reason,
      calculated_at: r.calculated_at,
    };
  }

  return { neighborhoods, scores, truncated };
}
