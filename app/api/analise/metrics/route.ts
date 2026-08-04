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
// "Cobertura de dados" usava cities.data_level='full' (só 10 de 5.570
// cidades ativas -- granularidade de hidrografia local/terreno real/bairro
// oficial), o que divergia do "% com score" mostrado na tabela expandida por
// estado (perto de 100%) e tornava o card enganoso. Agora os dois medem a
// mesma coisa: % de cidades ativas com uma linha em city_risk_summary
// (mantida pelo próprio cron), agregado nacionalmente aqui e por estado na
// expansão -- ver ExpandedCobertura em app/analise/page.tsx.
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
         (select count(*) from user_reports where confirmations + denials > 0) as relatos_com_reacao,
         (select count(distinct city_id) from user_reports where city_id is not null) as cidades_com_relatos,
         (select round(
            count(crs.city_id)::float / nullif(count(c.id), 0) * 100
          ) from cities c left join city_risk_summary crs on crs.city_id = c.id where c.active) as cobertura_dados`
    );

    // Cobertura por estado -- expansão do card "Cobertura de dados" (ver
    // Item 4 da página /analise). city_risk_summary já tem state/data_level/
    // last_updated por cidade (mantida pelo próprio cron, ver
    // lib/riskScoring.ts), então não precisa agregar direto de risk_scores.
    const { rows: coverageRows } = await db.query(
      `select
         c.state,
         count(*) as municipios,
         coalesce(sum(nb.bairros), 0) as bairros,
         round(count(*) filter (where crs.city_id is not null)::float / nullif(count(*), 0) * 100) as pct_com_score,
         mode() within group (order by c.data_level) as data_level_predominante,
         max(crs.last_updated) as ultima_atualizacao
       from cities c
       left join city_risk_summary crs on crs.city_id = c.id
       left join (select city_id, count(*) as bairros from neighborhoods group by city_id) nb on nb.city_id = c.id
       where c.active
       group by c.state
       order by c.state`
    );

    const row = rows[0];
    return NextResponse.json({
      total_relatos: Number(row.total_relatos ?? 0),
      taxa_media_confirmacao: row.taxa_media_confirmacao === null ? null : Number(row.taxa_media_confirmacao),
      relatos_com_reacao: Number(row.relatos_com_reacao ?? 0),
      cidades_com_relatos: Number(row.cidades_com_relatos ?? 0),
      cobertura_dados: row.cobertura_dados === null ? null : Number(row.cobertura_dados),
      coverage_by_state: coverageRows.map((r) => ({
        state: r.state,
        municipios: Number(r.municipios),
        bairros: Number(r.bairros),
        pct_com_score: r.pct_com_score === null ? null : Number(r.pct_com_score),
        data_level_predominante: r.data_level_predominante,
        ultima_atualizacao: r.ultima_atualizacao,
      })),
    });
  } catch (err) {
    return handleApiError(err, "api/analise/metrics");
  }
}
