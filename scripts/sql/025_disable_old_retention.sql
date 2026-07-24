-- Desativa o downsampling de risk_scores da migração 004 (pg_cron,
-- job "chuvarada-cleanup-risk-scores") -- superado pelo arquivamento pro
-- Backblaze B2 (23/07/2026, ver lib/b2.ts e scripts/archive_to_b2.ts).
--
-- Os dois mecanismos faziam trabalho sobreposto e conflitante: a 004 já
-- reduzia risk_scores com mais de 24h pra 1 registro/hora (e além de 14
-- dias, 1/dia) ANTES do archive_to_b2.ts (corte de 48h) conseguir
-- arquivar em resolução plena -- ou seja, o que ia pro B2 já não era o
-- dado original, e sim o que a 004 tinha deixado passar.
select cron.unschedule('chuvarada-cleanup-risk-scores');

drop function if exists cleanup_risk_scores();
