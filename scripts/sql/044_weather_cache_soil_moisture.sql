-- soil_moisture como nova variável do modelo (soil_moisture_0_to_7cm..100_to_255cm
-- do Open-Meteo, índice ponderado 0-1 -- ver lib/weather.ts).
--
-- Precisa da coluna em DUAS tabelas, não só weather_cache: RiskFactors.tsx
-- (painel de bairro) lê os fatores de risco a partir de RiskScore, que
-- espelha 1:1 as colunas de risk_scores (ver types/index.ts) -- sem a coluna
-- aqui também, o breakdown do bairro nunca mostraria soil_moisture, mesmo
-- com o cálculo do score já usando o dado.
ALTER TABLE weather_cache
ADD COLUMN IF NOT EXISTS soil_moisture numeric(5,4) DEFAULT 0.5;

ALTER TABLE risk_scores
ADD COLUMN IF NOT EXISTS soil_moisture numeric(5,4) DEFAULT 0.5;
