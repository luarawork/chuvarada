-- Achado do relatório de testes pré-deploy: weather_cache.rain_source
-- registra a fonte só no momento do fetch, mas não fica gravado no
-- histórico de risk_scores — não dava pra saber com precisão quantos
-- scores JÁ CALCULADOS usaram MERGE vs Open-Meteo (o cron faz cache-hit
-- em muitos ciclos sem regravar weather_cache, mas ainda assim usa o
-- valor correto no cálculo do score).
alter table risk_scores add column if not exists rain_source text default 'openmeteo';
