# Agendadores de cron — Chuvarada

Documenta as 3 opções de agendamento implementadas pro cron de risco
(`/api/cron/update`) e pro script do MERGE (`scripts/fetch_merge_cptec.py`),
depois do achado 🔴 do `scripts/relatorio_testes_pre_deploy.md`: nenhum
agendador estava configurado, então o cron só rodava quando disparado
manualmente.

## Opção A — Vercel Cron (`vercel.json`)

**Já existia no repositório**, criado no commit inicial do projeto, e já
estava correto: dispara `/api/cron/update` a cada 20 minutos (`*/20 * * * *`,
não os 30 minutos do pedido original — 20min é a cadência real do modelo,
documentada em `/como-funciona` e no README).

Nenhuma mudança necessária aqui — só verificado.

**Limitação a saber**: o plano Hobby (gratuito) da Vercel limita cron jobs a
no máximo 1 execução por dia por cron — precisa do plano Pro pra rodar a
cada 20 minutos de verdade. Isso não é algo que dá pra contornar no código;
é uma decisão de qual plano contratar na hora do deploy.

## Opção B — GitHub Actions (independente de plataforma)

Dois workflows novos, ambos com `workflow_dispatch` pra disparo manual de
teste, além do agendamento automático:

### `.github/workflows/cron-update.yml`
Dispara `/api/cron/update` a cada 20 minutos.

**Correção em relação ao pedido original**: o exemplo dado usava `curl -X POST`,
mas a rota (`app/api/cron/update/route.ts`) só implementa `export async function GET`
— um POST retornaria 405 Method Not Allowed. Corrigido pra `GET`. Também
adicionado `--max-time 570` (9,5min) — o teste de carga da bateria anterior
mediu ~5min31s pro ciclo completo, e o timeout precisa cobrir isso com
folga, senão o GitHub Actions mataria a conexão no meio do processamento
(o que não quebraria o processamento no servidor, que continua rodando
independente do cliente desconectar — comportamento já observado
repetidamente nesta sessão — mas deixaria o job do Actions marcado como
falho sem necessidade).

**Secrets necessários no repositório** (Settings → Secrets and variables →
Actions): `CRON_SECRET` (mesmo valor do `.env.local`/produção) e `APP_URL`
(URL pública do app, ex: `https://chuvarada.vercel.app`).

### `.github/workflows/merge-cache-update.yml`
Roda `scripts/fetch_merge_cptec.py` a cada hora.

**Correção em relação ao pedido original**: o exemplo dado listava
`pip install rasterio numpy geopandas supabase`. Conferindo os imports
reais do script (`import rasterio`, `numpy`, `requests`, e
`pg8000.native` dentro de `save_rows`), **`geopandas` e `supabase` não são
usados** (esse script não faz pré-processamento geoespacial nem usa o
client REST do Supabase) e **`pg8000` estava faltando** (é o driver
Postgres de fato usado pra gravar em `merge_cache` — `psycopg2` não está
disponível no ambiente Python deste projeto, ver `scripts/README_merge.md`).
Corrigido pra `pip install rasterio numpy requests pg8000`.

**Secret necessário**: `SUPABASE_CONNECTION_STRING`.

### O que foi validado nesta sessão vs. o que precisa do deploy real
- ✅ Sintaxe YAML dos 2 workflows validada (`js-yaml`, sem erros).
- ✅ Lógica conferida contra o código real (rota GET, dependências reais do script).
- ❌ **Não dá pra testar o disparo automático de verdade sem fazer push pro
  GitHub e configurar os secrets** — isso é uma ação que афeta o repositório
  remoto e precisa de confirmação separada. Depois do push + secrets
  configurados, dá pra forçar uma execução manual imediata via
  `gh workflow run cron-update.yml` (ou pela aba Actions no GitHub) sem
  esperar o agendamento, pra validar de ponta a ponta.

## Opção C — `node-cron` interno (preparação, servidor persistente)

Pra quando/se o deploy for num servidor persistente (Railway/Render) em vez
de serverless — `vercel.json` e a função do Netlify não se aplicam nesse
cenário, porque não há uma plataforma orquestrando o agendamento por fora.

- **`lib/internalScheduler.ts`**: usa `node-cron` (já era dependência do
  projeto, `package.json`) pra chamar `/api/cron/update` internamente a
  cada 20 minutos.
- **`instrumentation.ts`**: hook oficial do Next.js, chamado 1x quando o
  processo do servidor sobe — liga o agendador interno.

**Só ativa com `ENABLE_INTERNAL_CRON=true`** — por padrão fica desligado.
Isso é importante: se ligado num ambiente serverless (Vercel/Netlify), cada
requisição roda numa instância nova e efêmera, então o `node-cron` nunca
completaria um ciclo de 20 minutos direito, e ainda duplicaria o
agendamento nativo da plataforma. **Só ativar em servidor persistente.**

Testado nesta sessão: com `instrumentation.ts` adicionado mas
`ENABLE_INTERNAL_CRON` ausente (comportamento padrão), o servidor de
desenvolvimento sobe normalmente, sem erros — confirma que a preparação é
segura por padrão (no-op) até alguém decidir ativá-la.

## Opção D (bônus, não pedida) — Netlify Scheduled Functions

O pedido original citava um `netlify.toml` com `@netlify/plugin-crons` —
**esse pacote não existe** na documentação oficial da Netlify. O mecanismo
real chama-se
[Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/),
configurado via `export const config = { schedule: "..." }` dentro do
próprio arquivo da function (não precisa de `netlify.toml` separado pra
isso).

Criado **`netlify/functions/scheduled-cron.mts`**, agendado a cada 20
minutos.

**Achado importante durante a implementação**: funções agendadas da
Netlify têm **limite de 30 segundos de execução** — bem menor que os
~5min31s que o ciclo completo do cron leva. A função foi escrita pra
disparar a chamada e desistir de esperar a resposta completa depois de 25s
(`AbortController`), confiando no mesmo comportamento já observado
inúmeras vezes nesta sessão: o processo Next.js continua processando o
ciclo inteiro no servidor mesmo depois que o cliente (aqui, a função da
Netlify) desiste de esperar. Isso não é uma solução perfeita — não há
confirmação de que o ciclo completou — mas é a única forma de usar
Scheduled Functions da Netlify com um cron desse tamanho sem reescrever a
arquitetura do endpoint.

## Resumo — o que fazer na hora do deploy real

1. Escolher a plataforma (Vercel, Netlify, ou servidor persistente).
2. Se Vercel: `vercel.json` já está pronto — só garantir plano Pro (ou
   aceitar frequência menor no Hobby).
3. Se Netlify: `netlify/functions/scheduled-cron.mts` já está pronto,
   configurar as env vars `APP_URL`/`CRON_SECRET` no painel da Netlify.
4. Se servidor persistente: definir `ENABLE_INTERNAL_CRON=true` +
   `APP_URL`/`CRON_SECRET` nas env vars do servidor.
5. **Em qualquer caso**, configurar os secrets do GitHub Actions
   (`CRON_SECRET`, `APP_URL`, `SUPABASE_CONNECTION_STRING`) como camada de
   redundância independente da plataforma — útil especialmente enquanto o
   MERGE não tem um agendador nativo em nenhuma das plataformas serverless.
