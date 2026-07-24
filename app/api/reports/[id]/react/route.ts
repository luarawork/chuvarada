import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerSupabase } from "@/lib/supabase";
import { calculateExpiresAt } from "@/lib/reports";
import { getClientIp, hashIp } from "@/lib/reportRateLimit";
import { handleApiError, rejectIfPayloadTooLarge } from "@/lib/apiError";
import type { ReportSeverity, UserReport } from "@/types";

type Reaction = "confirm" | "deny";
const VALID_REACTIONS: Reaction[] = ["confirm", "deny"];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Código do Postgres pra violação de unique constraint -- usado aqui pra
// detectar "esse usuário/IP já reagiu a esse relato" sem precisar de um
// select prévio (evita race condition entre o select e o insert).
const UNIQUE_VIOLATION = "23505";

async function getUserIdFromAuthHeader(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await getServerSupabase().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: reportId } = await params;
  if (!UUID_REGEX.test(reportId)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const tooLarge = rejectIfPayloadTooLarge(req);
  if (tooLarge) return tooLarge;

  const body = await req.json().catch(() => null);
  const reaction: Reaction | undefined = body?.reaction;

  if (!reaction || !VALID_REACTIONS.includes(reaction)) {
    return NextResponse.json({ error: "reaction deve ser confirm ou deny" }, { status: 400 });
  }

  const userId = await getUserIdFromAuthHeader(req);
  const ipHash = hashIp(getClientIp(req));

  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("begin");

    try {
      await client.query(
        `insert into report_reactions (report_id, user_id, ip_hash, reaction) values ($1, $2, $3, $4)`,
        [reportId, userId, ipHash, reaction]
      );
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        await client.query("rollback");
        return NextResponse.json({ error: "Você já reagiu a esse relato" }, { status: 409 });
      }
      throw err;
    }

    const column = reaction === "confirm" ? "confirmations" : "denials";
    const { rows } = await client.query(
      `update user_reports set ${column} = ${column} + 1
       where id = $1 and status = 'active'
       returning *`,
      [reportId]
    );

    if (rows.length === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Relato não encontrado ou não está mais ativo" }, { status: 404 });
    }

    let report = rows[0] as UserReport;

    // Só confirmação estende a expiração -- negação não deveria fazer um
    // relato durar menos do que a gravidade original prevê, só sinaliza
    // desconfiança da comunidade (ver denials no cruzamento futuro).
    if (reaction === "confirm") {
      const newExpiresAt = calculateExpiresAt(report.severity as ReportSeverity, report.confirmations);
      const { rows: updatedRows } = await client.query(
        `update user_reports set expires_at = $2 where id = $1 returning *`,
        [reportId, newExpiresAt.toISOString()]
      );
      report = updatedRows[0] as UserReport;
    }

    await client.query("commit");
    return NextResponse.json({ report });
  } catch (err) {
    await client.query("rollback");
    return handleApiError(err, "api/reports/[id]/react");
  } finally {
    client.release();
  }
}
