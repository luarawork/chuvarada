-- Função RPC pra monitoramento diário de tamanho do banco (ver
-- .github/workflows/monitor-database.yml). SECURITY DEFINER roda com o
-- privilégio de quem criou a função (não do chamador via PostgREST), por
-- isso consegue ler pg_database_size/pg_tables mesmo chamada pela anon key
-- -- mas SECURITY DEFINER sozinho não é suficiente pra expor via REST: sem
-- o GRANT EXECUTE abaixo (que o pedido original não incluía), PostgREST
-- devolve 401/"permission denied for function" pra qualquer chamador,
-- porque roles novas de função não são utilizáveis por anon/authenticated
-- por padrão no Supabase.
create or replace function get_db_size()
returns json
language sql
security definer
as $$
  select json_build_object(
    'size_mb', round(pg_database_size(current_database()) / 1024 / 1024.0, 2),
    'tables', (
      select json_agg(json_build_object(
        'table', tablename,
        'size_mb', round(pg_total_relation_size('public.'||tablename) / 1024 / 1024.0, 2)
      ) order by pg_total_relation_size('public.'||tablename) desc)
      from pg_tables
      where schemaname = 'public'
      limit 10
    )
  );
$$;

-- ATENÇÃO -- isso expõe o tamanho de cada tabela do banco pra qualquer
-- portador da chave anon (que é PÚBLICA por design: é a mesma
-- NEXT_PUBLIC_SUPABASE_ANON_KEY embutida no bundle do cliente). Não é
-- credencial nem dado de usuário, mas é informação operacional interna --
-- mesma categoria do achado M6/M7 da auditoria de segurança que gateou
-- /api/health atrás do CRON_SECRET. Optado por deixar público mesmo assim
-- (pedido explícito de rodar via anon key de dentro do GitHub Action, sem
-- CRON_SECRET plumbing pra RPC do PostgREST) -- documentado aqui como
-- trade-off consciente, não descuido.
grant execute on function get_db_size() to anon, authenticated;
