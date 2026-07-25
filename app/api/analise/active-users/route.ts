import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveStatesFilter } from "@/lib/geo";
import { maskEmail } from "@/lib/mask";
import { handleApiError } from "@/lib/apiError";

// Usuários mais ativos no período, pra página /analise (seção "Usuários
// mais ativos" -- ver Item 6.2 do pedido). Usa getDb() (conexão direta ao
// Postgres, bypassa RLS) igual todo resto do projeto -- não precisa de um
// client admin separado, já que essa conexão já enxerga auth.users.
//
// GET /api/analise/active-users?region=RN&start=2026-07-19&end=2026-07-25
interface ActiveUserRow {
  user_id: string | null;
  email: string | null;
  total_relatos: number;
  confirmacoes_recebidas: number;
  negacoes_recebidas: number;
}

function reliabilityStars(pct: number | null): number {
  if (pct === null) return 0;
  if (pct > 70) return 3;
  if (pct >= 40) return 2;
  return 1;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const region = searchParams.get("region");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  const states = resolveStatesFilter(region);
  if (!states) {
    return NextResponse.json(
      { error: "Parâmetro region inválido -- use uma UF, 'BR', ou uma região (norte/nordeste/sudeste/sul/centro-oeste)" },
      { status: 400 }
    );
  }
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "Parâmetros obrigatórios (formato YYYY-MM-DD): start, end" }, { status: 400 });
  }

  try {
    const db = getDb();

    // Agrupado por user_id -- todos os relatos anônimos (user_id null) caem
    // numa linha só, sem distinguir por ip_hash: é o que impede expor
    // qualquer coisa que identifique um usuário anônimo individual aqui.
    const { rows } = await db.query<ActiveUserRow>(
      `select
         r.user_id,
         u.email,
         count(r.id)::int as total_relatos,
         coalesce(sum(r.confirmations), 0)::int as confirmacoes_recebidas,
         coalesce(sum(r.denials), 0)::int as negacoes_recebidas
       from user_reports r
       join cities c on c.id = r.city_id
       left join auth.users u on u.id = r.user_id
       where c.state = any($1::text[])
         and r.created_at >= $2::date
         and r.created_at < ($3::date + interval '1 day')
       group by r.user_id, u.email
       order by total_relatos desc
       limit 10`,
      [states, start, end]
    );

    const users = rows.map((row) => {
      const totalVotes = row.confirmacoes_recebidas + row.negacoes_recebidas;
      const taxaConfirmacao = totalVotes > 0 ? Math.round((row.confirmacoes_recebidas / totalVotes) * 100) : null;
      return {
        usuario: row.user_id ? maskEmail(row.email ?? "") : "Anônimo",
        total_relatos: row.total_relatos,
        confirmacoes_recebidas: row.confirmacoes_recebidas,
        taxa_confirmacao: taxaConfirmacao,
        confiabilidade: reliabilityStars(taxaConfirmacao),
      };
    });

    const { rows: countRows } = await db.query<{ total: number }>(
      `select count(distinct coalesce(r.user_id::text, 'anon'))::int as total
       from user_reports r
       join cities c on c.id = r.city_id
       where c.state = any($1::text[])
         and r.created_at >= $2::date
         and r.created_at < ($3::date + interval '1 day')`,
      [states, start, end]
    );

    return NextResponse.json({ users, totalActiveUsers: countRows[0]?.total ?? 0 });
  } catch (err) {
    return handleApiError(err, "api/analise/active-users");
  }
}
