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
| `SUPABASE_CONNECTION_STRING` | `update_merge`, `archive` | String de conexão Postgres do Supabase -- **usar o connection pooler (Transaction mode, porta 6543), não a conexão direta (porta 5432)**. Ver "IPv6 e o connection pooler" abaixo pro motivo. | Supabase → botão **Connect** (não Project Settings → Database) → aba **Transaction pooler** → copiar a URI |
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
   todos os bairros).
4. Confirmar no Supabase que os dados realmente mudaram:

   ```sql
   -- merge_cache deve ter fetched_at de agora mesmo
   select max(fetched_at) from merge_cache;

   -- risk_scores deve ter calculated_at de agora mesmo
   select max(calculated_at) from risk_scores;
   ```

Se `update_merge` falhar: geralmente é `SUPABASE_CONNECTION_STRING`
ausente/errada, o CPTEC estar temporariamente fora do ar (o script aborta
sem gravar nada nesse caso — ver "O que fazer se o CPTEC estiver fora do
ar" em `README_merge.md`), ou o erro específico de rede descrito em
"IPv6 e o connection pooler" abaixo — esse último aparece só depois de já
ter baixado os arquivos do MERGE com sucesso, na hora de abrir a conexão
com o banco (`OSError: [Errno 101] Network is unreachable` ou
`pg8000.exceptions.InterfaceError` no traceback).

Se `update_scores` falhar com 401: `CRON_SECRET` do secret do GitHub não
bate com o `CRON_SECRET` configurado na plataforma de deploy — precisam
ser o mesmo valor nos dois lugares.

## IPv6 e o connection pooler

O host de conexão direta do Supabase (`db.<project-ref>.supabase.co:5432`)
só tem endereço **IPv6** -- confirmado via `dns.lookup` com `all:true`,
zero registro A (IPv4). Os runners `ubuntu-latest` do GitHub Actions não
têm rota de saída IPv6 nenhuma, então qualquer script que abra conexão
Postgres direta com esse host falha na hora (não é timeout -- é
`OSError: [Errno 101] Network is unreachable`, o kernel dizendo que não
existe rota, não que demorou pra responder). Isso já derrubou
`fetch_merge_cptec.py` em produção depois que o resto do script (download
do MERGE) tinha rodado sem erro nenhum -- o traceback só aparece na hora
de `pg8000.Connection(...)`.

**Correção**: usar o **connection pooler** do Supabase (Transaction mode,
porta 6543) em vez do host direto -- resolve pra endereço IPv4 de verdade
(confirmado com DNS lookup + handshake TCP), que os runners alcançam sem
problema. Mesma senha, mesmo banco -- só o host, a porta e o usuário
mudam (usuário ganha o sufixo `.{project-ref}` no modo pooler, ex:
`postgres.kskogxhujmqmfdgwpeph` em vez de só `postgres`). Nenhum código
muda -- tanto `fetch_merge_cptec.py` (`urlparse` manual) quanto
`archive_to_b2.ts` (`pg.Pool`) fazem parse de URL padrão, que funciona
igual pras duas formas de connection string.

Isso vale pra **qualquer lugar** que guarde `SUPABASE_CONNECTION_STRING`
apontando pro host direto -- não só o secret do GitHub, mas também
`.env.local` e as env vars de produção (Vercel ou outra plataforma), que
podem estar expostas ao mesmo tipo de falha intermitente dependendo da
rota IPv6 disponível naquele ambiente específico.

## Decisão: GitHub Actions é a única fonte de agendamento

Este projeto já teve **4 mecanismos** capazes de disparar `/api/cron/update`
no mesmo horário (`0 * * * *`): esta Action, `vercel.json` (cron nativo do
Vercel), `netlify/functions/scheduled-cron.mts` (cron nativo do Netlify) e
`lib/internalScheduler.ts` (agendador em processo via `node-cron`). Rodar
mais de um ao mesmo tempo causava a mesma classe de race condition do
incidente de Natal — nenhum deles sabia que os outros existiam, nem
esperava `update_merge` terminar antes de disparar.

**Resolvido**: `vercel.json` e a function do Netlify foram removidos do
repositório (ver `docs/diagnostico_agendadores_cron.md` pro histórico da
decisão). Só restam duas fontes possíveis hoje:

- **GitHub Actions** (este workflow) — a fonte real em produção.
- `lib/internalScheduler.ts` — mantido só como alternativa pra deploy num
  servidor persistente (Railway/Render) sem acesso a GitHub Actions.
  Inativo por padrão (`ENABLE_INTERNAL_CRON` ausente/`false`) e, se algum
  dia for ativado, note que ele chama o `/api/cron/update` antigo (cron
  único), não os 2 cronos separados que esta Action usa — não são
  equivalentes, ver aviso de depreciação no topo de
  `app/api/cron/update/route.ts`.

O lock em `system_locks` (`scripts/sql/018_system_locks.sql` + checagem em
`lib/merge.ts`) continua como segunda camada de proteção independente da
decisão acima: mesmo que dois disparos aconteçam por engano, `getMergeData()`
detecta o lock ativo e trata `merge_cache` como indisponível nesse ciclo
(cai pro fallback Open-Meteo) em vez de ler metade das células atualizadas
e metade não.
