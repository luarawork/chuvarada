-- Achados do Supabase Advisor: 2 funções SECURITY DEFINER com EXECUTE
-- aberto demais.
--
-- rls_auto_enable() -- verificado: é a função de um event trigger (RETURNS
-- event_trigger) que liga RLS automaticamente em toda tabela nova criada
-- em public. Postgres não deixa chamar uma função de event trigger via
-- SELECT direto (só dispara sozinha em CREATE TABLE), então o GRANT a
-- anon/authenticated não era diretamente explorável -- mas não tem
-- nenhuma razão legítima pra ficar público, e o Advisor está certo em
-- pedir o REVOKE por princípio de menor privilégio.
--
-- get_db_size() -- verificado contra a migração 035: retorna json (não
-- bigint) com size_mb + breakdown das top 10 tabelas por tamanho, usado
-- ativamente nesta sessão (scripts/one-off/emergency_cleanup_20260809.js
-- e outros) pra diagnosticar o incidente de espaço em disco. O GRANT a
-- anon/authenticated era um trade-off consciente (ver comentário da
-- 035_db_size_function.sql) pro antigo monitor-database.yml chamar via
-- REST/anon key sem plumbing de CRON_SECRET pra RPC. Esse motivo não
-- existe mais -- monitor-health.yml (ver commit c95757f) usa a connection
-- string privilegiada via psycopg2, não chama mais essa RPC -- então o
-- REVOKE de anon já não quebra nenhum fluxo em produção.
--
-- IMPORTANTE: revogar só de anon/authenticated não fecha o buraco de
-- verdade -- as duas funções também têm EXECUTE concedido a PUBLIC (todo
-- role herda isso implicitamente, achado verificado via
-- information_schema.routine_privileges antes de escrever esta migração).
-- Sem revogar de PUBLIC também, anon/authenticated continuariam
-- conseguindo chamar as duas funções mesmo depois do REVOKE explícito.

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_db_size() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_db_size() FROM PUBLIC;
-- authenticated mantém acesso de propósito (não foi pedido pra revogar, e
-- a 035 original também concedia pra authenticated) -- só reconcede aqui
-- porque o REVOKE ... FROM PUBLIC acima não remove o grant explícito que
-- authenticated já tinha por conta própria (papéis nomeados e PUBLIC são
-- concessões independentes em Postgres).

-- Corrige search_path mutável em get_db_size (SECURITY DEFINER sem
-- search_path fixo é risco real de shadowing de schema) -- MANTÉM o corpo
-- original (json com size_mb + tables) em vez de trocar por um retorno
-- bigint simples, que quebraria todo código que já depende do formato
-- atual.
CREATE OR REPLACE FUNCTION public.get_db_size()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'size_mb', round(pg_database_size(current_database()) / 1024 / 1024.0, 2),
    'tables', (
      SELECT json_agg(json_build_object(
        'table', tablename,
        'size_mb', round(pg_total_relation_size('public.'||tablename) / 1024 / 1024.0, 2)
      ) ORDER BY pg_total_relation_size('public.'||tablename) DESC)
      FROM pg_tables
      WHERE schemaname = 'public'
      LIMIT 10
    )
  );
$$;
