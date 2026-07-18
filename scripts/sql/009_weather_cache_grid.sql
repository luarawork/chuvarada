-- Antes, o clima era buscado 1x por cidade (coordenada central) e aplicado
-- a TODOS os bairros dela -- Salvador e Natal, por exemplo, têm bairros
-- com chuva bem diferente entre si, mas todos recebiam o mesmo rain_72h.
-- Agora o clima é buscado por célula de uma grade geográfica (~5km), e
-- cada bairro usa a célula em que seu centróide cai. lat/lng aqui é o
-- centro da célula, não da cidade.
alter table weather_cache add column if not exists lat double precision;
alter table weather_cache add column if not exists lng double precision;

create index if not exists weather_cache_cell_lookup on weather_cache (city_id, lat, lng, fetched_at desc);
