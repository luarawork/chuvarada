import { createHash } from "crypto";
import { getDb } from "./db";

const MAX_REPORTS_PER_HOUR = 3;

export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) throw new Error("IP_HASH_SALT não definida");
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

// Limite de relatos anônimos por IP -- não se aplica a relatos autenticados
// (o abuso de múltiplas contas já é mais custoso que múltiplos IPs).
export async function checkRateLimit(ipHash: string): Promise<{ allowed: boolean; count: number }> {
  const db = getDb();
  const { rows } = await db.query<{ count: string }>(
    `select count(*) from user_reports
     where ip_hash = $1 and created_at >= now() - interval '1 hour'`,
    [ipHash]
  );
  const count = parseInt(rows[0].count, 10);
  return { allowed: count < MAX_REPORTS_PER_HOUR, count };
}
