-- Lock simples pra sinalizar "merge_cache está sendo escrito agora" --
-- protege contra o cron de scores (rodado por qualquer um dos schedulers:
-- GitHub Action, cron nativo do Vercel/Netlify, ou o agendador interno)
-- ler merge_cache no meio de um lote de escrita do fetch_merge_cptec.py
-- (~31.500 células, alguns minutos por execução). Ver scripts/README_merge.md
-- e o incidente de Natal (21/07/2026) que motivou isso.
create table if not exists system_locks (
  key text primary key,
  locked_at timestamptz not null default now(),
  locked_by text
);
