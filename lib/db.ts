import { Pool } from "pg";

// Conexão direta ao Postgres do Supabase, usada só em código server-side
// (API routes / cron). Bypassa RLS — necessário porque cities/neighborhoods/
// risk_scores/risk_events/tide_cache/weather_cache só têm policy de leitura
// pública, sem policy de insert/update para a anon key, e não há uma
// SUPABASE_SERVICE_ROLE_KEY configurada para o cliente supabase-js.
let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    const connectionString = process.env.SUPABASE_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("SUPABASE_CONNECTION_STRING não definida");
    }
    // max maior que o default (10) porque o cron agora processa cidades em
    // paralelo (~1800 cidades ativas desde a expansão pro Nordeste inteiro) —
    // com o default, a concorrência do cron ficava presa esperando conexão
    // livre em vez de aproveitar o paralelismo de fato.
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 15 });
  }
  return pool;
}
