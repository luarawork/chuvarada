-- Marca de onde veio rain_72h/rain_peak_3h nessa leitura — 'merge_cptec'
-- quando havia dado do MERGE recente o suficiente (<6h), 'openmeteo' no
-- fallback (ver lib/weather.ts). Útil pra diagnóstico e pra /como-funciona
-- mostrar a fonte real usada por bairro.
alter table weather_cache add column if not exists rain_source text default 'openmeteo';
