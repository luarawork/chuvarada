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
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}
