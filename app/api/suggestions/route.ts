import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerSupabase } from "@/lib/supabase";
import { getClientIp, hashIp, checkSuggestionRateLimit } from "@/lib/reportRateLimit";
import { rejectIfPayloadTooLarge } from "@/lib/apiError";

const VALID_TYPES = ["bug", "feature", "data", "coverage", "other"];
const MAX_DESCRIPTION_LENGTH = 1000;
// Corrige achado baixo B1 da auditoria de segurança -- checagem simples de
// formato, não RFC 5322 completo (não precisa ser perfeito, só descartar
// lixo óbvio antes de gravar).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getUserIdFromAuthHeader(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await getServerSupabase().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export async function POST(req: NextRequest) {
  const tooLarge = rejectIfPayloadTooLarge(req);
  if (tooLarge) return tooLarge;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const { type, description, contact_email } = body;

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "type deve ser bug, feature, data, coverage ou other" }, { status: 400 });
  }
  if (typeof description !== "string" || description.trim().length === 0 || description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { error: `description é obrigatória e deve ter no máximo ${MAX_DESCRIPTION_LENGTH} caracteres` },
      { status: 400 }
    );
  }
  if (contact_email !== undefined && contact_email !== null && contact_email !== "") {
    if (typeof contact_email !== "string" || !EMAIL_REGEX.test(contact_email)) {
      return NextResponse.json({ error: "contact_email inválido" }, { status: 400 });
    }
  }

  const ipHash = hashIp(getClientIp(req));
  const { allowed, count } = await checkSuggestionRateLimit(ipHash);
  if (!allowed) {
    return NextResponse.json(
      { error: `Limite de sugestões atingido (${count} nas últimas 24h). Tente novamente amanhã.` },
      { status: 429 }
    );
  }

  const userId = await getUserIdFromAuthHeader(req);
  const db = getDb();
  const { rows } = await db.query(
    `insert into user_suggestions (user_id, type, description, contact_email, ip_hash)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [userId, type, description.trim(), contact_email || null, ipHash]
  );

  return NextResponse.json({ suggestion: rows[0] }, { status: 201 });
}
