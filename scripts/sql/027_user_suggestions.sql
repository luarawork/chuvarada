-- Sugestões enviadas pelo modal compartilhado (/perfil e /como-funciona) --
-- ver app/api/suggestions/route.ts, components/ui/SuggestionModal.tsx.
create table if not exists user_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  type text not null check (type in ('bug', 'feature', 'data', 'coverage', 'other')),
  description text not null,
  contact_email text,
  status text default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at timestamptz default now()
);

alter table user_suggestions enable row level security;

create policy "suggestions_anyone_insert"
  on user_suggestions for insert with check (true);

-- Só o autor vê as próprias sugestões (não há painel de admin ainda --
-- leitura via anon key/RLS é suficiente por enquanto).
create policy "suggestions_owner_read"
  on user_suggestions for select using (auth.uid() = user_id);
