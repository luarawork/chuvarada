import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Client administrativo (service_role), só pra app/api/suggestions/all e
// app/api/suggestions/[id] -- a página interna /sugestoes precisa ler e
// atualizar TODAS as sugestões, não só as do usuário autenticado (RLS de
// user_suggestions só permite auth.uid() = user_id, ver
// scripts/sql/027_user_suggestions.sql). SUPABASE_SERVICE_KEY nunca é
// exposta ao cliente -- só lida aqui, server-side.
let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !serviceKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_KEY não configuradas");
    }
    adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return adminClient;
}
