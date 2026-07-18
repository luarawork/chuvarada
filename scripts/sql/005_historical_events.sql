-- historical_events — eventos históricos de desastre para validação do modelo de risco
create table if not exists historical_events (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references cities(id),
  neighborhood_id uuid references neighborhoods(id),
  event_type text,
  event_date date,
  source text,
  raw_data jsonb,
  created_at timestamptz default now()
);

alter table historical_events enable row level security;
drop policy if exists "historical_events_public_read" on historical_events;
create policy "historical_events_public_read" on historical_events for select using (true);
