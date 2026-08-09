-- Achado em 09/08/2026: lock do Cron A com TTL curto demais (10min) permitiu
-- duas execuções sobrepostas duplicarem risk_scores inteiro em 2 horas
-- (08/08 05h e 07h) -- ver ADR e commit do aumento de LOCK_MAX_AGE_MINUTES
-- pra 20min em app/api/cron/scores/route.ts, que resolve a causa raiz.
--
-- Esta constraint é defesa em profundidade: mesmo que o lock falhe de novo
-- por outro motivo (workflow_dispatch manual sobreposto, futura mudança de
-- código), uma segunda inserção pro mesmo bairro na mesma hora não duplica
-- silenciosamente -- fica noop via ON CONFLICT DO NOTHING (ver
-- insertRiskScoresBatch em lib/riskScoring.ts).
--
-- date_trunc(text, timestamptz) sozinho não é IMMUTABLE (depende do timezone
-- da sessão) -- Postgres recusa index nessa expressão. "AT TIME ZONE 'UTC'"
-- fixa o timezone como constante, tornando a expressão IMMUTABLE e válida
-- pra index.
create unique index if not exists risk_scores_neighborhood_hour_uniq
on risk_scores (neighborhood_id, date_trunc('hour', calculated_at at time zone 'utc'));
