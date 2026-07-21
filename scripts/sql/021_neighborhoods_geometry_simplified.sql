-- Geometria simplificada (Douglas-Peucker, tolerancia ~0.0001 grau / ~10m)
-- pra renderizacao no mapa -- medido que geometria e' 44-84% do payload de
-- /api/neighborhoods dependendo do zoom (mais pesado ainda em viewports
-- largos, onde mais poligonos complexos entram de uma vez). Coluna
-- separada em vez de sobrescrever `geometry`: mantem a geometria original
-- (fonte IBGE) intacta para qualquer uso futuro que precise de precisao
-- real, servindo a simplificada so' pra visualizacao.
alter table neighborhoods
  add column if not exists geometry_simplified jsonb;
