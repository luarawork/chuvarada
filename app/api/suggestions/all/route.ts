import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { maskEmail } from "@/lib/mask";
import { verifyAdminPassword } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

// Leitura completa de user_suggestions pra página interna /sugestoes --
// RLS normal (policy "suggestions_owner_read") só deixa cada usuário ver as
// próprias sugestões, então precisa do client admin (service_role,
// bypassa RLS -- ver lib/supabaseAdmin.ts).
//
// contact_email vem mascarado já aqui no servidor (não só na renderização
// da página): esse endpoint devolve dado pra uma página sem autenticação
// própria (acesso só por URL direta, ver app/sugestoes/page.tsx), então o
// e-mail completo nunca deve sair da API pra começo de conversa. ip_hash
// também nunca é selecionado.
//
// GET /api/suggestions/all
export async function GET(req: NextRequest) {
  if (!verifyAdminPassword(req.headers.get("x-admin-password"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("user_suggestions")
      .select("id, type, description, contact_email, status, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const suggestions = (data ?? []).map((row) => ({
      ...row,
      contact_email: row.contact_email ? maskEmail(row.contact_email) : null,
    }));

    return NextResponse.json({ data: suggestions });
  } catch (err) {
    return handleApiError(err, "api/suggestions/all GET");
  }
}
