-- View com o score mais recente de cada bairro. Existe porque o frontend
-- precisava buscar isso via `.in("neighborhood_id", <706 ids>)`, o que gera
-- uma URL grande demais pro PostgREST engolir (falha silenciosa, sem erro
-- tratado no código) assim que o número de bairros passa de uns 300-400.
create or replace view latest_risk_scores as
select distinct on (neighborhood_id) *
from risk_scores
order by neighborhood_id, calculated_at desc;

alter view latest_risk_scores set (security_invoker = true);
