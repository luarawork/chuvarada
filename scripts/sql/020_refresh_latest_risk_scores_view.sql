-- `create or replace view ... select *` (008) congela a lista de colunas no
-- momento da criação -- não acompanha `alter table risk_scores add column`
-- feito depois (012 rain_peak_3h, 015 rain_source). A view ficou sem essas
-- duas colunas mesmo com elas presentes na tabela, quebrando qualquer query
-- que faça `rs.rain_peak_3h`/`rs.rain_source` contra a view (ver
-- app/api/neighborhoods/route.ts). Recriar pra pegar o schema atual.
create or replace view latest_risk_scores as
select distinct on (neighborhood_id) *
from risk_scores
order by neighborhood_id, calculated_at desc;

alter view latest_risk_scores set (security_invoker = true);
