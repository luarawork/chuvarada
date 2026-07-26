-- Retenção em dois níveis pra merge_cache: células perto de bairro (usadas
-- de verdade pelo score, ver lib/merge.ts) guardam 7 dias; o resto do bbox
-- nacional (cobertura de grade que nunca é lida por nenhum bairro real,
-- só existe porque o download do MERGE vem em bbox retangular) guarda só
-- 3 dias -- ver scripts/archive_to_b2.ts (archiveMergeCache) e
-- scripts/maintenance.sql pra onde essa coluna é consumida.
--
-- ATENÇÃO -- grade do merge_cache != grade de lib/grid.ts. lib/grid.ts
-- (gridCell) arredonda ingenuamente pra múltiplo de 0.1 (usado só pra
-- agrupar bairro->célula de CLIMA, weather_cache). merge_cache.grid_lat/
-- grid_lng vêm da grade NATIVA do satélite MERGE/CPTEC, que tem origem
-- deslocada (ver GRID_ORIGIN_LAT/LON em scripts/fetch_merge_cptec.py):
-- xdef 1001 linear -120.05 0.1 / ydef 924 linear -60.05 0.1 -- ou seja,
-- todo grid_lat/grid_lng real termina em ",X5" (-60.05, -59.95, -59.85...),
-- nunca em múltiplo redondo de 0.1 (-6.0, -5.9...). Arredondar ingenuamente
-- (como uma primeira versão desta migração fazia) gera coordenadas que
-- NUNCA batem com nenhuma linha real de merge_cache -- a tabela abaixo
-- ficaria populada mas inútil pra qualquer join. A expressão usa a mesma
-- fórmula de "ponto da grade nativa mais próximo" que o Python já usa pra
-- gerar a grade (origem + round((valor - origem) / passo) * passo).
create table if not exists merge_cache_cells (
  grid_lat float not null,
  grid_lng float not null,
  is_near_neighborhood boolean default false,
  primary key (grid_lat, grid_lng)
);

-- round(..., 4) na expressão final -- mesma precisão de canonical_grid()
-- (round(lat, 4) em Python) que gera os grid_lat/grid_lng reais gravados em
-- merge_cache. Sem isso, uma diferença de epsilon de ponto flutuante entre
-- o cálculo em Postgres (numeric) e em Python (float64) poderia fazer a
-- comparação de igualdade exata (row in near_cells, ver fetch_merge_cptec.py)
-- nunca bater mesmo pra células genuinamente próximas.
insert into merge_cache_cells (grid_lat, grid_lng, is_near_neighborhood)
select distinct
  round((round(((centroid_lat - (-60.05)) / 0.1)::numeric) * 0.1 + (-60.05))::numeric, 4)::float as grid_lat,
  round((round(((centroid_lng - (-120.05)) / 0.1)::numeric) * 0.1 + (-120.05))::numeric, 4)::float as grid_lng,
  true as is_near_neighborhood
from neighborhoods
on conflict (grid_lat, grid_lng) do update set is_near_neighborhood = true;

alter table merge_cache
  add column if not exists is_near_neighborhood boolean default false;
