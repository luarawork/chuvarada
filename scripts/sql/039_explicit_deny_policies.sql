-- Formaliza com policy explícita o que já era o comportamento de fato em
-- city_risk_summary, cron_run_stats, merge_cache_cells e system_locks: RLS
-- habilitado, zero policies de leitura = sempre [] pra qualquer chamador
-- client-side (anon/authenticated via REST). Nenhuma das 4 é consultada
-- pelo cliente hoje -- todo acesso é server-side, via a connection string
-- privilegiada que ignora RLS (ver lib/db.ts) -- então isso não muda
-- comportamento nenhum, só documenta a intenção explicitamente em vez de
-- depender do "zero policies = deny" implícito, seguindo o mesmo padrão já
-- adotado pra system_locks/cron_run_stats desde a correção do achado C1
-- (ver 029_fix_report_reactions_rls.sql).

create policy "city_risk_summary_deny"
on public.city_risk_summary for all
using (false);

create policy "cron_run_stats_deny"
on public.cron_run_stats for all
using (false);

create policy "merge_cache_cells_deny"
on public.merge_cache_cells for all
using (false);

create policy "system_locks_deny"
on public.system_locks for all
using (false);
