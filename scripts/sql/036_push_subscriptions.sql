-- Notificações push (28/07/2026) -- ver lib/webpush.ts,
-- app/api/push/subscribe, app/api/push/send, hooks/usePushNotifications.ts.
-- Uma linha por subscription de browser (endpoint único por dispositivo/
-- navegador), não por usuário -- o mesmo usuário logado em 2 dispositivos
-- gera 2 linhas.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  neighborhood_ids uuid[] default '{}', -- bairros favoritos para notificar
  notify_on_attention boolean default true,
  notify_on_critical boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists push_subscriptions_neighborhood_ids
  on push_subscriptions using gin (neighborhood_ids);

alter table push_subscriptions enable row level security;

-- Usuário só acessa suas próprias subscriptions -- mesmo padrão de
-- report_reactions/user_reports: a leitura/escrita real das rotas em
-- app/api/push/* passa pela conexão direta via pg (lib/db.ts), que
-- bypassa RLS; a policy documenta a intenção caso algum dia um client
-- Supabase autenticado consulte a tabela diretamente.
create policy "push_sub_owner" on push_subscriptions
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
