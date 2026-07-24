import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseBbox } from "@/lib/geo";
import { handleApiError } from "@/lib/apiError";

// Polígonos municipais pros modos heatmap/municipality no zoom afastado
// (zoom < 10, ver ZOOM_THRESHOLDS em app/page.tsx) -- nesse zoom, bairro é
// ilegível/pesado demais (ver diagnóstico de performance), e um ponto de
// cidade (city_risk_summary puro) não dá pra desenhar como área. Igual ao
// endpoint de bairros: filtra por centroide (índice dedicado,
// municipalities_centroid) e serve geometry_simplified.
// 4.653 municípios cabem nesse teto (ver scripts/process_municipalities.py) --
// bem acima do necessário mesmo pro viewport de "Brasil inteiro" no modo
// heatmap, que é o único caso realista de aproximar do total. Só existe
// como salvaguarda contra bbox absurdo (ex: 0,0 a 0,0 do mundo todo). Antes
// de aumentar a tolerância de simplificação (ver process_municipalities.py),
// um teto de 1.500 cobria só ~32% do país de uma vez no zoom mais afastado
// -- de forma arbitrária, sem ORDER BY -- então o Brasil inteiro nunca
// aparecia completo no modo heatmap.
const MAX_MUNICIPALITIES_PER_REQUEST = 5000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const bbox = parseBbox(searchParams);
  if (!bbox) {
    return NextResponse.json(
      { error: "Parâmetros north/south/east/west são obrigatórios, numéricos e dentro de um bbox razoável" },
      { status: 400 }
    );
  }

  try {
    const db = getDb();

    // city_risk_summary já é uma tabela (não view calculada na hora, ver
    // migração 022) com 1 linha por cidade -- join comum de novo aqui, sem
    // o teto de LATERAL que fez sentido pra risk_scores (não há
    // des-duplicação nenhuma acontecendo, é join 1:1 direto).
    const { rows } = await db.query(
      `select
         m.id, m.city_id, m.name, m.state,
         m.geometry_simplified as geometry,
         m.centroid_lat, m.centroid_lng,
         crs.worst_level, crs.max_score, crs.critical_count, crs.attention_count
       from municipalities m
       left join city_risk_summary crs on crs.city_id = m.city_id
       where m.centroid_lat between $1 and $2
         and m.centroid_lng between $3 and $4
       limit $5`,
      [bbox.south, bbox.north, bbox.west, bbox.east, MAX_MUNICIPALITIES_PER_REQUEST + 1]
    );

    const truncated = rows.length > MAX_MUNICIPALITIES_PER_REQUEST;
    const page = truncated ? rows.slice(0, MAX_MUNICIPALITIES_PER_REQUEST) : rows;

    const data = page.map((r) => ({
      id: r.id,
      city_id: r.city_id,
      name: r.name,
      state: r.state,
      geometry: typeof r.geometry === "string" ? JSON.parse(r.geometry) : r.geometry,
      centroid_lat: r.centroid_lat,
      centroid_lng: r.centroid_lng,
      worst_level: r.worst_level ?? "normal",
      max_score: r.max_score,
      critical_count: r.critical_count ?? 0,
      attention_count: r.attention_count ?? 0,
    }));

    return NextResponse.json({ data, truncated });
  } catch (err) {
    return handleApiError(err, "api/municipalities");
  }
}
