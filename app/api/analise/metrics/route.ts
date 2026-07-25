import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handleApiError } from "@/lib/apiError";

// Métricas gerais do produto pra página /analise (seção "Métricas do
// produto", cards sem filtro de período -- ver Item 6.3). Os cards COM
// filtro de período (relatos/divergências/eventos críticos/usuários ativos
// no período selecionado) não precisam de endpoint próprio: já são
// derivados client-side dos dados que o handleSearch da página já busca
// (reports, hourlyComparison, criticalEvents) + o total de
// /api/analise/active-users.
//
// "Cobertura de dados" reaproveita cities.data_level (full/partial/minimal,
// já existente no schema) em vez de inventar um novo critério: % de cidades
// ativas com cobertura completa de dados (bairros + hidrografia + maré).
//
// GET /api/analise/metrics
export async function GET() {
  try {
    const db = getDb();
    const { rows } = await db.query(
      `select
         (select count(*) from user_reports) as total_relatos,
         (select round(avg(r.confirmations::float / nullif(r.confirmations + r.denials, 0)) * 100)
            from user_reports r
            where r.confirmations + r.denials > 0) as taxa_media_confirmacao,
         (select count(distinct city_id) from user_reports where city_id is not null) as cidades_com_relatos,
         (select round(
            count(*) filter (where data_level = 'full')::float / nullif(count(*), 0) * 100
          ) from cities where active) as cobertura_dados`
    );

    const row = rows[0];
    return NextResponse.json({
      total_relatos: Number(row.total_relatos ?? 0),
      taxa_media_confirmacao: row.taxa_media_confirmacao === null ? null : Number(row.taxa_media_confirmacao),
      cidades_com_relatos: Number(row.cidades_com_relatos ?? 0),
      cobertura_dados: row.cobertura_dados === null ? null : Number(row.cobertura_dados),
    });
  } catch (err) {
    return handleApiError(err, "api/analise/metrics");
  }
}
