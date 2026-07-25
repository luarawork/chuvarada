-- Remove a geometria original (resolução plena) de neighborhoods --
-- geometry_simplified (Douglas-Peucker, ~100m, ver migração
-- 021_neighborhoods_geometry_simplified.sql) é o que o app sempre serviu
-- pra visualização; confirmado em 25/07/2026 que as 28.483 linhas de
-- neighborhoods já tinham geometry_simplified preenchida (0 NULL), então
-- não há perda de cobertura visual.
--
-- ATENÇÃO -- antes de rodar isso em qualquer ambiente, os 2 lugares do
-- código que ainda liam a coluna geometry original precisam estar
-- corrigidos e já em produção:
--   - app/api/neighborhoods/route.ts tinha
--     `coalesce(n.geometry_simplified, n.geometry) as geometry` -- sem
--     correção, essa query quebra (erro de SQL, coluna inexistente) pra
--     TODO carregamento de bairro do mapa assim que a coluna suma.
--   - app/api/score/route.ts fazia `select("*", ...)` e usava
--     `n.geometry` (a coluna crua, não a simplificada) direto via
--     turf.centroid -- endpoint sem chamador no frontend hoje, mas
--     quebraria (500) se chamado.
-- Os dois foram migrados pra usar geometry_simplified (aliada como
-- "geometry" na resposta, mesma convenção das outras rotas) no mesmo
-- commit desta migração.
--
-- geometry original é preservada nos shapefiles brutos baixados do IBGE
-- (não versionados no repo, mas parte do pipeline em scripts/) -- se
-- precisar recalcular/ressimplificar no futuro, o caminho é reprocessar a
-- partir de lá, não a partir do banco.
alter table neighborhoods
  drop column if exists geometry;

-- municipalities já teve a coluna geometry removida antes (ver migração
-- 024_drop_municipalities_geometry.sql, 22/07/2026) -- checagem abaixo é
-- só pra confirmar que não sobrou nada antes de seguir pro VACUUM FULL.
select column_name from information_schema.columns
where table_name = 'municipalities'
  and column_name in ('geometry', 'geometry_simplified');
