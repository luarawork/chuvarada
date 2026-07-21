-- Migração de variáveis secundárias (rain_1h, vento, umidade, pressão) de
-- Open-Meteo para WeatherAPI.com. rain_source (migração 014) já rastreia
-- qual fonte forneceu rain_72h/rain_peak_3h (merge vs openmeteo) -- esse é
-- um eixo diferente: qual provedor forneceu as variáveis secundárias desta
-- linha (weatherapi na maioria dos casos, openmeteo quando a WeatherAPI
-- falha e o fallback entra em ação).
alter table weather_cache add column if not exists weather_source text default 'weatherapi';
