-- Polígonos municipais (IBGE, malha municipal 2022) usados pelos modos
-- heatmap e municipality do mapa no zoom afastado (zoom < 10) -- nesses
-- modos não faz sentido carregar geometria de bairro (ilegível/pesada
-- nessa escala, ver diagnóstico de performance), mas um ponto de cidade
-- (city_risk_summary) também não dá pra desenhar como área. Tabela
-- separada de `cities` (que só tem lat/lng, sem geometria) e de
-- `neighborhoods` (bairro, não município).
create table if not exists municipalities (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references cities(id) on delete cascade,
  name text not null,
  state text not null,
  geometry jsonb not null,
  geometry_simplified jsonb not null,
  centroid_lat float not null,
  centroid_lng float not null,
  created_at timestamptz default now()
);

create index if not exists municipalities_centroid
  on municipalities(centroid_lat, centroid_lng);

create unique index if not exists municipalities_city_id
  on municipalities(city_id);

alter table municipalities enable row level security;

create policy "municipalities_public_read"
  on municipalities for select using (true);
