-- Centroide pré-calculado de cada bairro/distrito, usado pelo endpoint
-- /api/neighborhoods pra filtrar por viewport (bbox) sem precisar
-- processar geometria completa a cada requisição. Não usa PostGIS (não
-- está instalado neste projeto e todo cálculo de geometria já é feito em
-- código -- turf.js/shapely -- em vez de SQL, ver process_state_neighborhoods.py
-- e app/page.tsx) -- os valores são calculados e gravados por
-- scripts/backfill_neighborhood_centroids.js.
--
-- Motivação: com 24.556 bairros, `select * from neighborhoods` sem filtro
-- sempre batia no limite de 1000 linhas do PostgREST -- só ~4% do Brasil
-- (e nenhum bairro de São Paulo) chegava a aparecer no mapa. Ver
-- diagnóstico da investigação "São Paulo não aparece no mapa".
alter table neighborhoods
  add column if not exists centroid_lat float,
  add column if not exists centroid_lng float;

create index if not exists neighborhoods_centroid
  on neighborhoods (centroid_lat, centroid_lng);
