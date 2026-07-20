-- rain_1h/rain_intensity só capturavam o instante exato em que o cron
-- rodava — picos de chuva forte que duram menos que os 20 minutos entre
-- execuções passavam despercebidos (achado do diagnóstico do mapa "todo
-- verde" do fim de semana de 18-19/07/2026, apesar de rain_72h real de
-- >50mm em vários bairros). rain_peak_3h guarda o maior valor de
-- precipitação horária observado nas últimas 3h, não só o valor atual.
alter table weather_cache add column if not exists rain_peak_3h float default 0;
