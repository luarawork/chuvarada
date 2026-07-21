-- Índices usados pelo modo cidade (zoom-out): sem neighborhoods_city_id, o
-- agregado por cidade faria seq scan de neighborhoods inteira (24.556
-- linhas) por cidade -- mesma lição do bug de performance corrigido em
-- /api/neighborhoods. cities_lat_lng é pequena (4.653 linhas) hoje mas
-- escala com o tempo.
create index if not exists neighborhoods_city_id on neighborhoods(city_id);
create index if not exists cities_lat_lng on cities(lat, lng);

-- Pior nível/score agregado por cidade, pro modo "pontos" do mapa no
-- zoom-out. TABELA real (não view calculada na hora): testado com
-- EXPLAIN ANALYZE que agregar "score mais recente de cada bairro" ao vivo
-- -- via LATERAL por bairro ou via CTE com merge join -- leva 1,1s a 3,2s
-- pra ~500 cidades (~3.260 bairros), rápido demais de re-executar a cada
-- pan/zoom mas devagar demais pra manter interativo. Como o cron já
-- recalcula o score de cada bairro de uma cidade de uma vez e já tem esse
-- resultado em memória (ver processCity em app/api/cron/update/route.ts),
-- ele mesmo atualiza esta tabela logo depois de gravar risk_scores -- custo
-- adicional ~zero (nenhuma query nova, só mais um upsert pequeno por
-- cidade), e o endpoint fica um SELECT indexado trivial.
create table if not exists city_risk_summary (
  city_id uuid primary key references cities(id) on delete cascade,
  name text not null,
  state text not null,
  lat float not null,
  lng float not null,
  data_level text,
  max_score float,
  worst_level text check (worst_level in ('normal', 'attention', 'critical')),
  critical_count int not null default 0,
  attention_count int not null default 0,
  last_updated timestamptz,
  refreshed_at timestamptz not null default now()
);

create index if not exists city_risk_summary_lat_lng on city_risk_summary(lat, lng);
