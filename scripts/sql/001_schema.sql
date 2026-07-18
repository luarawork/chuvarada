-- Chuvarada — schema inicial
-- Tabelas principais

create table if not exists cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  state text not null,
  lat float not null,
  lng float not null,
  tide_code text,
  data_level text check (data_level in ('full', 'partial', 'minimal')) default 'minimal',
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists neighborhoods (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references cities(id) on delete cascade,
  name text not null,
  geometry jsonb not null,
  terrain_slope float default 0,
  hydro_proximity float default 0,
  is_coastal boolean default false,
  created_at timestamptz default now()
);

create table if not exists risk_scores (
  id uuid primary key default gen_random_uuid(),
  neighborhood_id uuid references neighborhoods(id) on delete cascade,
  score float not null check (score >= 0 and score <= 1),
  level text check (level in ('normal', 'attention', 'critical')) not null,
  rain_1h float default 0,
  rain_72h float default 0,
  rain_intensity float default 0,
  terrain_slope float default 0,
  hydro_proximity float default 0,
  tide_level float default 0,
  wind_speed float default 0,
  wind_direction float default 0,
  humidity float default 0,
  pressure float default 0,
  auto_critical boolean default false,
  auto_critical_reason text,
  calculated_at timestamptz default now()
);

create index if not exists risk_scores_neighborhood_time on risk_scores(neighborhood_id, calculated_at desc);

create table if not exists risk_events (
  id uuid primary key default gen_random_uuid(),
  neighborhood_id uuid references neighborhoods(id) on delete cascade,
  level text not null,
  peak_score float,
  started_at timestamptz default now(),
  ended_at timestamptz,
  confirmed boolean default false
);

create table if not exists tide_cache (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references cities(id) on delete cascade,
  month int not null,
  year int not null,
  data jsonb not null,
  cached_at timestamptz default now(),
  unique(city_id, month, year)
);

create table if not exists weather_cache (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references cities(id) on delete cascade,
  rain_1h float default 0,
  rain_72h float default 0,
  rain_intensity float default 0,
  wind_speed float default 0,
  wind_direction float default 0,
  humidity float default 0,
  pressure float default 0,
  fetched_at timestamptz default now()
);

create table if not exists user_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  neighborhood_id uuid references neighborhoods(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, neighborhood_id)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  neighborhood_id uuid references neighborhoods(id) on delete cascade,
  level text not null,
  message text,
  sent_at timestamptz default now()
);
