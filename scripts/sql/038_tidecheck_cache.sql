-- Integração com a API do TideCheck (tidecheck.com) -- maré em tempo real
-- pra substituir o fallback neutro (CPTEC confirmado fora do ar, ver
-- lib/cptec.ts). Cota gratuita: 50 requisições/dia.
--
-- NOTA: NÃO reaproveita a tabela `tide_cache` já existente (city_id/month/
-- year/data jsonb, criada na migração 001 pro CPTEC) -- schema incompatível,
-- tabela nova com nome distinto pra não colidir.
--
-- 115 cidades costeiras têm tide_code hoje -- "1 requisição/cidade/dia"
-- geraria 115+/dia, acima da cota de 50. Em vez de buscar só o nível atual
-- todo dia, cada busca traz a série prevista de ~10 dias inteira
-- (timeSeries da API) e ela fica válida até perto do fim dessa janela --
-- o nível "agora" é interpolado da série em cache a cada leitura, sem
-- nenhuma chamada de rede. Isso reduz a necessidade real pra ~115/9 ≈ 13
-- cidades/dia em regime permanente (bem dentro da cota), com backfill
-- inicial de todas as 115 espalhado por alguns dias.

-- Estação escolhida por cidade -- praticamente não muda ao longo do tempo,
-- então fica gravada direto em cities em vez de ser buscada de novo a cada
-- ciclo (economiza a metade das requisições que o fluxo ingênuo gastaria).
ALTER TABLE cities ADD COLUMN IF NOT EXISTS tide_station_id text;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS tide_station_type text
  CHECK (tide_station_type IN ('uhslc', 'fes2022'));
ALTER TABLE cities ADD COLUMN IF NOT EXISTS tide_station_distance_km numeric(6,2);

CREATE TABLE IF NOT EXISTS tidecheck_cache (
  city_id uuid PRIMARY KEY REFERENCES cities(id),
  station_id text NOT NULL,
  station_type text NOT NULL CHECK (station_type IN ('uhslc', 'fes2022')),
  height_min numeric(6,3) NOT NULL,
  height_max numeric(6,3) NOT NULL,
  -- Série prevista completa (~961 pontos, 15 em 15min, ~10 dias), formato
  -- [{time, height}] -- o nível "agora" é calculado a partir dela em
  -- tempo de leitura (lib/cptec.ts), não gravado como um valor único que
  -- ficaria desatualizado em poucas horas.
  time_series jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  -- Último instante coberto por time_series -- usado pelo cron pra saber
  -- quais cidades precisam de reabastecimento (ordenado por mais antigo).
  series_ends_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS tidecheck_cache_series_ends_at
ON tidecheck_cache(series_ends_at);

-- RLS: leitura pública, igual weather_cache/merge_cache (ver Database.md) --
-- escrita só via pool pg direto do cron (bypassa RLS).
ALTER TABLE tidecheck_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY tidecheck_cache_read ON tidecheck_cache FOR SELECT USING (true);
