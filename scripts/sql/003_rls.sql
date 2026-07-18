-- RLS

alter table cities enable row level security;
drop policy if exists "cities_public_read" on cities;
create policy "cities_public_read" on cities for select using (true);

alter table neighborhoods enable row level security;
drop policy if exists "neighborhoods_public_read" on neighborhoods;
create policy "neighborhoods_public_read" on neighborhoods for select using (true);

alter table risk_scores enable row level security;
drop policy if exists "risk_scores_public_read" on risk_scores;
create policy "risk_scores_public_read" on risk_scores for select using (true);

alter table risk_events enable row level security;
drop policy if exists "risk_events_public_read" on risk_events;
create policy "risk_events_public_read" on risk_events for select using (true);

alter table tide_cache enable row level security;
drop policy if exists "tide_cache_public_read" on tide_cache;
create policy "tide_cache_public_read" on tide_cache for select using (true);

alter table weather_cache enable row level security;
drop policy if exists "weather_cache_public_read" on weather_cache;
create policy "weather_cache_public_read" on weather_cache for select using (true);

alter table user_favorites enable row level security;
drop policy if exists "favorites_own" on user_favorites;
create policy "favorites_own" on user_favorites
  for all using (auth.uid() = user_id);

alter table notifications enable row level security;
drop policy if exists "notifications_own" on notifications;
create policy "notifications_own" on notifications
  for select using (auth.uid() = user_id);
