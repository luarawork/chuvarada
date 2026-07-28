-- Executado uma vez (28/07/2026) pra recalcular cities.data_level com
-- critérios revisados -- os critérios originais (full/partial/minimal
-- definidos na expansão nacional) deixavam só 3 cidades em "full" e jogavam
-- praticamente tudo em "minimal", sem refletir o quanto do pipeline
-- (terrain_slope via SRTM, hydro_proximity via BHO) já está de fato
-- populado nacionalmente.
--
-- "Hidrografia local" (city_has_local_hydro) é Recife (municipal,
-- process_hydro_recife.py) e todo o estado de Sergipe (SERhidro,
-- process_hydro_sergipe.py) -- não existe coluna no banco marcando isso
-- por linha, então a lista fica hardcoded aqui mesmo.
--
-- Distribuição resultante (verificada em produção): full=10, partial=870,
-- minimal=4690 (de 3/162/4488 antes). NÃO rodar de novo sem revisar os
-- limiares -- uma primeira versão destes critérios (avg_hydro > 0.5, sem
-- o pct_bairro_real) jogava 5290 cidades em "partial", uma distribuição
-- pouco útil.

WITH city_stats AS (
  SELECT
    c.id,
    c.tide_code,
    AVG(n.hydro_proximity) as avg_hydro,
    COUNT(CASE WHEN n.terrain_slope != 0.5 THEN 1 END)::float /
      NULLIF(COUNT(*), 0) as pct_slope_real,
    COUNT(CASE WHEN n.name_source = 'bairro' THEN 1 END)::float /
      NULLIF(COUNT(*), 0) as pct_bairro_real
  FROM cities c
  LEFT JOIN neighborhoods n ON n.city_id = c.id
  WHERE c.active = true
  GROUP BY c.id, c.tide_code
),
city_has_local_hydro AS (
  SELECT DISTINCT c.id
  FROM cities c
  WHERE (c.name = 'Recife' AND c.state = 'PE')
  OR c.state = 'SE'
)
UPDATE cities c
SET data_level = CASE
  WHEN cs.id IN (SELECT id FROM city_has_local_hydro)
    AND cs.pct_slope_real > 0.95
    AND cs.pct_bairro_real > 0.80
  THEN 'full'

  WHEN cs.avg_hydro > 0.70
    AND cs.pct_slope_real > 0.90
    AND cs.pct_bairro_real > 0.50
  THEN 'partial'

  WHEN cs.tide_code IS NOT NULL
    AND cs.pct_slope_real > 0.90
  THEN 'partial'

  ELSE 'minimal'
END
FROM city_stats cs
WHERE c.id = cs.id;
