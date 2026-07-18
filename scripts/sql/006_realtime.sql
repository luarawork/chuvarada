-- Habilita o Supabase Realtime para risk_scores — sem isso, o hook
-- useRealtime (postgres_changes) nunca recebe nada, mesmo com RLS/insert
-- funcionando, porque a tabela não está na publicação que o Realtime escuta.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'risk_scores'
  ) then
    alter publication supabase_realtime add table risk_scores;
  end if;
end $$;
