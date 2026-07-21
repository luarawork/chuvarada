-- Cache do produto MERGE/CPTEC (precipitação diária/horária, satélite
-- GPM/IMERG-Late fundido com a rede de pluviômetros do INMET), grade de
-- ~10km. Populado por scripts/fetch_merge_cptec.py (script Python separado,
-- rodado fora do cron Node.js) — ver scripts/proposta_integracao_merge_cptec.md
-- pra motivação e scripts/README_merge.md pra operação.
create table if not exists merge_cache (
  id uuid primary key default gen_random_uuid(),
  lat float not null,
  lng float not null,
  grid_lat float not null,
  grid_lng float not null,
  rain_72h float default 0,
  rain_peak_3h float default 0,
  data_date date not null,
  data_hour int,
  source text default 'merge_cptec',
  fetched_at timestamptz default now(),
  unique(grid_lat, grid_lng, data_date)
);

alter table merge_cache enable row level security;
drop policy if exists "merge_cache_public_read" on merge_cache;
create policy "merge_cache_public_read" on merge_cache for select using (true);

create index if not exists merge_cache_grid on merge_cache(grid_lat, grid_lng);
