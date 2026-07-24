-- A policy "reports_public_read" (migração 026) só cobre status='active' --
-- a página /perfil precisa listar TODOS os relatos do próprio usuário,
-- inclusive expirados/resolvidos ("Meus relatos"), então falta uma policy
-- de leitura pelo dono.
create policy "reports_owner_read"
  on user_reports for select using (auth.uid() = user_id);
