import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { getDb } from "./db";

const MAX_REPORTS_PER_HOUR_ANONYMOUS = 3;
const MAX_REPORTS_PER_HOUR_AUTHENTICATED = 10;

// Corrige achado médio M1 da auditoria de segurança (24/07/2026,
// docs/relatorio_vulnerabilidades.md): X-Forwarded-For é um header que
// o CLIENTE controla -- um proxy confiável só ACRESCENTA o IP real ao
// final da lista, nunca substitui o que já veio. Pegar o primeiro item
// (como a versão antiga fazia) pega exatamente o valor que um atacante
// pode forjar, não o IP de fato adicionado pela borda confiável
// (Vercel/Netlify), permitindo contornar o rate limit de relatos
// anônimos e a dedupe de reação por IP só trocando o header a cada
// requisição. Header específico de plataforma (quando existe) é
// preferível por não ser forjável pelo cliente; x-forwarded-for cai pro
// último item (mais próximo da borda) como segunda opção.
export function getClientIp(req: NextRequest): string {
  const platformIp = req.headers.get("x-vercel-forwarded-for");
  if (platformIp) return platformIp.split(",")[0].trim();

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    return ips[ips.length - 1];
  }

  return req.headers.get("x-real-ip") ?? "unknown";
}

export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) throw new Error("IP_HASH_SALT não definida");
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

// Limite de relatos anônimos por IP.
export async function checkRateLimit(ipHash: string): Promise<{ allowed: boolean; count: number }> {
  const count = await countRecentReports("ip_hash", ipHash);
  return { allowed: count < MAX_REPORTS_PER_HOUR_ANONYMOUS, count };
}

// Corrige achado médio M2 da auditoria de segurança: antes, contas
// autenticadas não tinham limite nenhum (o comentário original assumia
// que criar conta já era barreira suficiente, mas o /auth não tem
// nenhuma proteção anti-automação própria). Limite mais generoso que o
// anônimo (10/h vs 3/h) porque uma conta real tem mais fricção pra criar
// em massa, mas não fica ilimitado.
export async function checkAuthenticatedRateLimit(userId: string): Promise<{ allowed: boolean; count: number }> {
  const count = await countRecentReports("user_id", userId);
  return { allowed: count < MAX_REPORTS_PER_HOUR_AUTHENTICATED, count };
}

async function countRecentReports(column: "ip_hash" | "user_id", value: string): Promise<number> {
  const db = getDb();
  const { rows } = await db.query<{ count: string }>(
    `select count(*) from user_reports
     where ${column} = $1 and created_at >= now() - interval '1 hour'`,
    [value]
  );
  return parseInt(rows[0].count, 10);
}

const MAX_SUGGESTIONS_PER_DAY = 5;

// Corrige achado médio M3 da auditoria de segurança: POST /api/suggestions
// não tinha rate limit nenhum, pra nenhum chamador. Por dia (não por hora
// como relatos) porque sugestão é uma ação bem menos urgente/repetível que
// relato de alagamento -- ver migração 030 (ip_hash em user_suggestions).
export async function checkSuggestionRateLimit(ipHash: string): Promise<{ allowed: boolean; count: number }> {
  const db = getDb();
  const { rows } = await db.query<{ count: string }>(
    `select count(*) from user_suggestions
     where ip_hash = $1 and created_at >= now() - interval '1 day'`,
    [ipHash]
  );
  const count = parseInt(rows[0].count, 10);
  return { allowed: count < MAX_SUGGESTIONS_PER_DAY, count };
}
