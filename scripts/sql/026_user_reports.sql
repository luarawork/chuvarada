-- Relatos de usuários (pin no mapa com gravidade leve/moderado/grave) --
-- ver lib/reports.ts, app/api/reports/route.ts, components/map/ReportLayer.tsx.
create table if not exists user_reports (
  id uuid primary key default gen_random_uuid(),

  -- Localização
  lat float not null,
  lng float not null,
  neighborhood_id uuid references neighborhoods(id) on delete set null,
  city_id uuid references cities(id) on delete set null,

  -- Conteúdo do relato
  severity text not null check (severity in ('leve', 'moderado', 'grave')),
  description text,

  -- Autoria
  user_id uuid references auth.users(id) on delete set null,
  is_anonymous boolean default true,
  ip_hash text,

  -- Validação pela comunidade
  confirmations int default 0,
  denials int default 0,

  -- Status
  status text default 'active' check (status in ('active', 'resolved', 'expired', 'removed')),
  resolved_at timestamptz,

  -- Contexto do modelo no momento do relato (pro cruzamento futuro)
  model_score float,
  model_level text,
  model_rain_72h float,
  model_rain_peak_3h float,

  created_at timestamptz default now(),
  expires_at timestamptz,

  app_version text,
  user_agent text
);

create index if not exists user_reports_location on user_reports(lat, lng);
create index if not exists user_reports_neighborhood on user_reports(neighborhood_id);
create index if not exists user_reports_status on user_reports(status, created_at desc);
create index if not exists user_reports_created on user_reports(created_at desc);

alter table user_reports enable row level security;

-- Leitura pública (relatos ativos) -- INSERT/UPDATE feitos via conexão
-- direta (pg, bypassa RLS) pelas rotas em app/api/reports, mesmo padrão do
-- resto do projeto (ver lib/db.ts: sem SUPABASE_SERVICE_ROLE_KEY
-- configurada, então "reports_owner_update" abaixo nunca seria satisfeita
-- por uma reação de OUTRO usuário confirmando/negando um relato alheio --
-- ela documenta a intenção, mas o app não depende dela pra funcionar).
create policy "reports_public_read"
  on user_reports for select using (status = 'active');

create policy "reports_anyone_insert"
  on user_reports for insert with check (true);

create policy "reports_owner_update"
  on user_reports for update using (auth.uid() = user_id);

-- Confirmações/negações de outros usuários sobre um relato.
create table if not exists report_reactions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references user_reports(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  ip_hash text,
  reaction text not null check (reaction in ('confirm', 'deny')),
  created_at timestamptz default now(),

  unique(report_id, user_id),
  unique(report_id, ip_hash)
);

alter table report_reactions enable row level security;

create policy "reactions_public_read"
  on report_reactions for select using (true);

create policy "reactions_anyone_insert"
  on report_reactions for insert with check (true);

-- Sem isso, o Supabase Realtime nunca dispara postgres_changes pra
-- user_reports -- é o que faz o hook useReports.ts (INSERT ao criar um
-- relato, UPDATE ao confirmar/negar/resolver) atualizar o mapa sem precisar
-- de refresh. Guardado num DO block porque "ALTER PUBLICATION ... ADD
-- TABLE" não aceita IF NOT EXISTS.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'user_reports'
  ) then
    alter publication supabase_realtime add table user_reports;
  end if;
end $$;
