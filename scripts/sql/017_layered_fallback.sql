-- Estratégia de fallback em camadas (Open-Meteo -> WeatherAPI.com -> cache
-- -> neutro) muda o significado de weather_cache.weather_source: antes era
-- só "qual provedor" (weatherapi/openmeteo), agora é "qual camada" (ver
-- types/index.ts). O default muda de 'weatherapi' pra 'openmeteo', que
-- volta a ser a camada 1 -- linhas antigas continuam com o valor que já
-- tinham, só o default de novas linhas muda.
alter table weather_cache alter column weather_source set default 'openmeteo';

-- Guarda um resumo por execução do cron (quantas células vieram de cada
-- camada) pra alimentar GET /api/health sem precisar rodar SQL manualmente
-- a cada consulta -- o contador de rate limit em si é só em memória do
-- processo (não sobrevive a um cold start serverless), mas esta tabela dá
-- uma visão do ciclo mais recente independente disso.
create table if not exists cron_run_stats (
  id uuid primary key default gen_random_uuid(),
  total_cities int not null,
  openmeteo_count int not null default 0,
  weatherapi_fallback_count int not null default 0,
  cache_emergency_count int not null default 0,
  neutral_fallback_count int not null default 0,
  completed_at timestamptz not null default now()
);

create index if not exists cron_run_stats_completed_at on cron_run_stats (completed_at desc);
