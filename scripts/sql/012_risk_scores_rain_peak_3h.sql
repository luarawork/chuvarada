-- Guarda o valor de rain_peak_3h realmente usado em cada cálculo de score
-- (ver 011_rain_peak_3h.sql) — sem essa coluna, o histórico de risk_scores
-- teria rain_intensity (instantâneo, ainda exibido separadamente) sem
-- nenhum registro do valor que de fato alimentou o peso de 25% da chuva.
alter table risk_scores add column if not exists rain_peak_3h float default 0;
