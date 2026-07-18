-- Estratégia de retenção do histórico de risk_scores
-- Granularidade alta apenas nas últimas 24h.
-- Entre 24h e 2 semanas: mantém 1 registro por hora (o mais recente da hora).
-- Além de 2 semanas: mantém 1 registro por dia (o mais recente do dia).
-- Requer a extensão pg_cron habilitada no projeto Supabase (Database > Extensions).

create extension if not exists pg_cron;

create or replace function cleanup_risk_scores() returns void as $$
begin
  -- agrega para granularidade horária entre 24h e 14 dias
  delete from risk_scores rs
  where rs.calculated_at < now() - interval '24 hours'
    and rs.calculated_at >= now() - interval '14 days'
    and rs.id not in (
      select distinct on (neighborhood_id, date_trunc('hour', calculated_at)) id
      from risk_scores
      where calculated_at < now() - interval '24 hours'
        and calculated_at >= now() - interval '14 days'
      order by neighborhood_id, date_trunc('hour', calculated_at), calculated_at desc
    );

  -- agrega para granularidade diária além de 14 dias
  delete from risk_scores rs
  where rs.calculated_at < now() - interval '14 days'
    and rs.id not in (
      select distinct on (neighborhood_id, date_trunc('day', calculated_at)) id
      from risk_scores
      where calculated_at < now() - interval '14 days'
      order by neighborhood_id, date_trunc('day', calculated_at), calculated_at desc
    );
end;
$$ language plpgsql;

select cron.schedule(
  'chuvarada-cleanup-risk-scores',
  '0 3 * * *',
  $$select cleanup_risk_scores();$$
);
