import { timingSafeEqual } from "crypto";

// Corrige achado crítico C2 da auditoria de segurança (24/07/2026,
// scripts/relatorio_vulnerabilidades.md): a comparação antiga
// (`authHeader !== \`Bearer ${process.env.CRON_SECRET}\``) falha ABERTA se
// CRON_SECRET não estiver definida no ambiente -- process.env.CRON_SECRET
// vira undefined, a string comparada passa a ser literalmente "Bearer
// undefined", e qualquer chamador que mande esse texto autentica. Com 4
// mecanismos diferentes de disparo do cron (GitHub Actions, Vercel,
// Netlify, agendador interno -- ver scripts/SETUP_ACTIONS.md), o risco de
// algum deles ficar sem o secret configurado é real, não hipotético.
//
// Fail-closed: sem secret configurado, nega sempre. Comparação
// timing-safe: evita vazar, pelo tempo de resposta, quantos bytes do
// header bateram com o esperado antes de divergir.
export function verifyCronSecret(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[auth] CRON_SECRET não configurada -- negando acesso (fail-closed)");
    return false;
  }
  if (!authHeader) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authHeader);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
