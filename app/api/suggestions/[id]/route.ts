import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyAdminPassword } from "@/lib/auth";
import { rejectIfPayloadTooLarge, handleApiError } from "@/lib/apiError";

// Atualização/remoção de sugestão pela página interna /sugestoes -- mesmo
// client admin de app/api/suggestions/all (RLS não permite update/delete de
// sugestão alheia, ver scripts/sql/027_user_suggestions.sql).
//
// Protegido pela mesma senha de /api/suggestions/all -- o pedido original
// só mencionava gatear o GET, mas deixar PATCH/DELETE aberto anularia o
// propósito da senha: são as rotas que MUDAM dado, mais sensíveis que a
// leitura.
const VALID_STATUSES = ["open", "in_review", "resolved"];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyAdminPassword(req.headers.get("x-admin-password"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const tooLarge = rejectIfPayloadTooLarge(req);
  if (tooLarge) return tooLarge;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const { status } = body;
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("user_suggestions")
      .update({ status })
      .eq("id", id)
      .select("id, type, description, status, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    return handleApiError(err, "api/suggestions/[id] PATCH");
  }
}

// DELETE não fazia parte do pedido original, mas o layout de /sugestoes
// pede um botão "Remover" por sugestão (ver Item 7.2) -- sem um endpoint de
// remoção esse botão não teria como funcionar.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyAdminPassword(req.headers.get("x-admin-password"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("user_suggestions").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "api/suggestions/[id] DELETE");
  }
}
