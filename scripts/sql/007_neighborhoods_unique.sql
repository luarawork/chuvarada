-- Garante que reprocessar bairros (upload_neighborhoods.js) seja idempotente
-- de verdade: sem essa unique constraint, o script antigo apagava e recriava
-- as linhas a cada rodada, gerando um id novo pra cada bairro e derrubando
-- (via on delete cascade) todo o risk_scores/risk_events já calculado.
alter table neighborhoods
  add constraint neighborhoods_city_id_name_key unique (city_id, name);
