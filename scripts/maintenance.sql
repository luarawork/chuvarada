-- Manutenção de espaço em disco do Supabase (plano free, limite de 0.5GB).
-- Rodar manualmente no SQL Editor quando o uso se aproximar do limite --
-- não é agendado automaticamente. Ver histórico: em 25/07/2026 o banco
-- chegou a 135% do limite (0.673GB); esta rotina reduziu pra ~521MB.
--
-- Ordem sugerida: 1) medir, 2) archive_to_b2.ts (risk_scores >48h, rodar
-- separadamente com `npx tsx scripts/archive_to_b2.ts`, não é SQL), 3) os
-- deletes abaixo, 4) VACUUM.

-- 1. Tamanho por tabela (rodar antes e depois pra medir o efeito)
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as tamanho
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 2. merge_cache: só serve pra calcular rain_72h/rain_peak_3h recentes
-- (ver lib/merge.ts) -- nada com mais de 3 dias é usado.
DELETE FROM merge_cache
WHERE fetched_at < NOW() - INTERVAL '3 days';

-- 3. weather_cache: manter só a leitura mais recente de cada cidade.
-- ATENÇÃO -- a versão originalmente proposta pra essa limpeza tinha um bug
-- de correlação (comparava cada linha contra "alguma linha da tabela que é
-- o próprio máximo dela mesma", o que é verdade pra toda cidade sempre, e
-- por isso nunca apagava nada). A versão abaixo correlaciona o MAX
-- diretamente com a linha candidata a exclusão (wc.city_id).
DELETE FROM weather_cache wc
WHERE fetched_at < NOW() - INTERVAL '24 hours'
  AND fetched_at <> (
    SELECT MAX(fetched_at) FROM weather_cache wc2 WHERE wc2.city_id = wc.city_id
  );

-- 4. VACUUM ANALYZE -- atualiza estatísticas do planner e marca o espaço
-- liberado pelos deletes acima como reutilizável para os PRÓXIMOS inserts
-- nas mesmas tabelas. NÃO encolhe o arquivo em disco nem reduz o que a
-- Supabase reporta como uso -- ver item 5 pra isso.
VACUUM ANALYZE risk_scores;
VACUUM ANALYZE merge_cache;
VACUUM ANALYZE weather_cache;

-- 5. VACUUM FULL -- só isso reescreve a tabela num arquivo menor e reduz de
-- verdade o número que a Supabase reporta. Trava a tabela (leitura E
-- escrita) por todo o tempo da operação -- em 25/07/2026, com merge_cache
-- em ~235MB, levou ~8s; risk_scores (~85MB) e weather_cache (~12MB) foram
-- bem mais rápidos ainda. Preferir rodar em horário de baixo tráfego se as
-- tabelas estiverem muito maiores que isso no futuro.
VACUUM FULL merge_cache;
VACUUM FULL risk_scores;
VACUUM FULL weather_cache;

-- Observação: municipalities e neighborhoods (polígonos IBGE, geometria
-- estática) costumam ser as maiores tabelas do banco depois dessa limpeza
-- e NÃO são afetadas por nada acima -- não são cache/histórico, são dado de
-- referência. Se o limite continuar sendo estourado mesmo com as tabelas
-- de cache/histórico limpas, o próximo passo é otimizar/comprimir essas
-- geometrias ou considerar upgrade de plano, não mais limpeza de cache.
