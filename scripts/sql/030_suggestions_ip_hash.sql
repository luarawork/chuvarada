-- Corrige achado médio M3 da auditoria de segurança (24/07/2026,
-- docs/relatorio_vulnerabilidades.md): POST /api/suggestions não tinha
-- rate limit nenhum, pra nenhum chamador -- precisa de uma coluna de
-- ip_hash pra poder limitar por IP, mesmo padrão já usado em user_reports
-- (ver lib/reportRateLimit.ts, nunca guarda o IP em texto puro).
alter table user_suggestions
  add column if not exists ip_hash text;

create index if not exists user_suggestions_ip_hash
  on user_suggestions (ip_hash, created_at desc);
