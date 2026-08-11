-- Persiste citiesWithErrors (Cron B) em cron_run_stats -- antes só existia
-- na resposta JSON do request, invisível pra qualquer diagnóstico via banco.
ALTER TABLE cron_run_stats
ADD COLUMN IF NOT EXISTS cities_with_errors integer DEFAULT 0;
