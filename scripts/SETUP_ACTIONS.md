# Configuração das GitHub Actions

Este projeto tem 3 GitHub Actions agendadas:

## 1. `merge-and-scores-update.yml` (a cada hora, `0 * * * *`)

2 jobs sequenciais:

1. `update_merge` — roda `scripts/fetch_merge_cptec.py`, que atualiza
   `merge_cache` com a chuva real do MERGE/CPTEC (ver `README_merge.md`).
2. `update_scores` — só começa depois que `update_merge` termina com
   sucesso (`needs: update_merge`) — chama `/api/cron/scores` (Cron A),
   que recalcula `risk_scores` pra todos os bairros a partir do
   `weather_cache`/`merge_cache` já existentes, sem chamar nenhuma API de
   clima (ver `docs/diagnostico_cron_arquitetura.md`).

Essa ordem por `needs` (não por horário/offset) é o que evita a race
condition descrita no incidente de Natal (21/07/2026): rodar os dois jobs
em paralelo ou fora de ordem fazia parte dos bairros ler célula de
`merge_cache` já atualizada nessa rodada e parte ler célula ainda não
tocada, misturando score correto com score subestimado na mesma cidade.

## 2. `weather-update.yml` (a cada 30min, `*/30 * * * *`)

Cron B -- mantém `weather_cache` atualizado aos poucos, em lotes pequenos
(chama `/api/cron/weather`), desacoplado do Cron A de propósito (ver
`docs/diagnostico_cron_arquitetura.md`).

## 3. `archive-history.yml` (diário às 02:00 UTC)

Move `risk_scores` com mais de 48h do Supabase pro Backblaze B2
(comprimido, particionado por data/estado) e gera o snapshot agregado do
dia anterior (`scripts/archive_to_b2.ts`) -- ver `lib/b2.ts` e
`/api/history`.

Sem os secrets abaixo configurados no repositório, as Actions falham (ou
nem disparam o passo que precisa deles) silenciosamente -- foi exatamente
esse o estado em que o projeto estava até o incidente de Natal: o workflow
existia no código, mas nunca tinha sido de fato ativado em produção.

## Secrets necessários

Configure em: **GitHub → repositório → Settings → Secrets and variables →
Actions → New repository secret**

| Secret | Usado por | Descrição | Onde obter |
|---|---|---|---|
| `SUPABASE_CONNECTION_STRING` | `update_merge`, `archive` | String de conexão Postgres do Supabase (formato `postgresql://user:senha@host:porta/banco`) | Supabase → Project Settings → Database → Connection string (modo "URI") |
| `CRON_SECRET` | `update_scores`, `update_weather` | Token que autentica a chamada em `/api/cron/scores` e `/api/cron/weather` (os endpoints rejeitam qualquer request sem `Authorization: Bearer <CRON_SECRET>` idêntico) | O mesmo valor já usado em `CRON_SECRET` no `.env.local`/nas env vars de produção — não é um valor novo, é o mesmo em todo lugar |
| `APP_URL` | `update_scores`, `update_weather` | URL pública do app em produção (ex: `https://chuvarada.vercel.app`), sem barra final | Definida no momento do deploy (Vercel/Netlify mostram a URL final) |
| `B2_ENDPOINT` | `archive` | Endpoint S3-compatible do Backblaze B2 (ex: `https://s3.us-east-005.backblazeb2.com`) | Backblaze → B2 Cloud Storage → Buckets → (nome do bucket) → Endpoint |
| `B2_BUCKET_NAME` | `archive` | Nome do bucket B2 usado pro histórico | Backblaze → B2 Cloud Storage → Buckets |
| `B2_KEY_ID` e `B2_APPLICATION_KEY` | `archive` | Credenciais da Application Key do B2 (par usado como `accessKeyId`/`secretAccessKey` no SDK S3) | Backblaze → App Keys → Add a New Application Key -- a `applicationKey` só é mostrada uma vez na criação |

`WEATHERAPI_KEY` **não** é secret desta Action — ela é lida pelo processo
Next.js em produção (variável de ambiente da plataforma de deploy, não do
GitHub Actions), usada só em runtime pelo fallback em `lib/weatherapi.ts`.

## Como testar se a Action está funcionando

Depois de configurar os 2 secrets acima:

1. GitHub → aba **Actions** → selecionar **"Update MERGE Cache + Risk
   Scores"** na lista à esquerda.
2. Botão **"Run workflow"** (canto superior direito) → **Run workflow**
   de novo pra confirmar.
3. Acompanhar os 2 jobs na execução: `update_merge` deve completar em
   ~1-2min, e só então `update_scores` começa (~5min30s pra processar
   todos os bairros — ver `netlify/functions/scheduled-cron.mts` sobre
   esse tempo).
4. Confirmar no Supabase que os dados realmente mudaram:

   ```sql
   -- merge_cache deve ter fetched_at de agora mesmo
   select max(fetched_at) from merge_cache;

   -- risk_scores deve ter calculated_at de agora mesmo
   select max(calculated_at) from risk_scores;
   ```

Se `update_merge` falhar: geralmente é `SUPABASE_CONNECTION_STRING`
ausente/errada, ou o CPTEC estar temporariamente fora do ar (o script
aborta sem gravar nada nesse caso — ver "O que fazer se o CPTEC estiver
fora do ar" em `README_merge.md`).

Se `update_scores` falhar com 401: `CRON_SECRET` do secret do GitHub não
bate com o `CRON_SECRET` configurado na plataforma de deploy — precisam
ser o mesmo valor nos dois lugares.

## Atenção: outros agendadores do mesmo `/api/cron/update`

Este projeto tem **3 outros mecanismos**, independentes desta Action, que
também podem chamar `/api/cron/update` no mesmo horário `0 * * * *`:

- `vercel.json` (cron nativo do Vercel)
- `netlify/functions/scheduled-cron.mts` (cron nativo do Netlify)
- `lib/internalScheduler.ts` (agendador em processo, via `node-cron`, só
  ativado se `ENABLE_INTERNAL_CRON=true` — pensado pra deploy em servidor
  persistente tipo Railway/Render)

Esses 3 existem como alternativas entre si pra cobrir diferentes
plataformas de deploy — a documentação de cada um já deixa claro que só
**um** deve estar ativo por vez, senão o cron de scores roda em
duplicidade.

O ponto que importa aqui: nenhum desses 3 sabe que este workflow do
GitHub Actions existe, nem espera o `update_merge` terminar antes de
disparar. Se a plataforma de deploy em uso tiver um desses ativo, ele vai
continuar chamando `/api/cron/update` direto no `:00` de toda hora,
**sem** a garantia de ordem que o `needs:` dá dentro desta Action — a
mesma race condition do incidente de Natal pode voltar a acontecer por
esse caminho.

É pra isso que serve o lock em `system_locks` (`scripts/sql/
018_system_locks.sql` + checagem em `lib/merge.ts`): mesmo que
`/api/cron/update` seja chamado no meio de uma escrita do
`fetch_merge_cptec.py` por qualquer um desses agendadores alternativos,
`getMergeData()` detecta o lock ativo e trata `merge_cache` como
indisponível nesse ciclo (cai pro fallback Open-Meteo) em vez de ler
metade das células atualizadas e metade não.

Ainda assim, a forma mais robusta de evitar a race é ter só **uma** fonte
de verdade dessas 4 (esta Action, Vercel, Netlify, agendador interno)
disparando o cron de scores — vale decidir qual delas é a real em
produção e desativar as outras 3.
