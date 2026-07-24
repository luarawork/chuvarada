import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerSupabase } from "@/lib/supabase";

const VALID_TYPES = ["bug", "feature", "data", "coverage", "other"];
const MAX_DESCRIPTION_LENGTH = 1000;

async function getUserIdFromAuthHeader(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await getServerSupabase().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export async function POST(req: NextRequest) {
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
  if (contact_email !== undefined && contact_email !== null && typeof contact_email !== "string") {
    return NextResponse.json({ error: "contact_email deve ser uma string" }, { status: 400 });
  }

  const userId = await getUserIdFromAuthHeader(req);
  const db = getDb();
  const { rows } = await db.query(
    `insert into user_suggestions (user_id, type, description, contact_email)
     values ($1, $2, $3, $4)
     returning *`,
    [userId, type, description.trim(), contact_email || null]
  );

  return NextResponse.json({ suggestion: rows[0] }, { status: 201 });
}
