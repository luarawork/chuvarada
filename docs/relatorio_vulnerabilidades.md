# Relatório de Vulnerabilidades — Chuvarada

Data do diagnóstico: 24/07/2026. Escopo: todos os endpoints em `app/api/`,
RLS do Supabase, exposição da anon key, variáveis de ambiente, sanitização
de input e headers de segurança.

**Status: todos os itens (2 críticos, 10 médios, 5 baixos) foram corrigidos
e testados ao vivo em 24/07/2026**, exceto B2 (atualização do Next.js),
tentada e revertida por incompatibilidade real com `next-pwa` — ver seção
B2 abaixo para o diagnóstico completo do conflito.

Metodologia: leitura de todo o código em `app/api/`, consulta direta a
`pg_policies`/`pg_class.relrowsecurity` no banco de produção, testes reais
contra a REST API do Supabase com a anon key pública, e `npm audit`. Os
testes de escrita/exclusão usaram IDs inexistentes ou dados de teste
criados e removidos na mesma sessão — nenhum dado real de usuário foi
tocado.

---

## Resumo executivo

| Severidade | Quantidade |
|---|---|
| 🔴 Crítico | 2 |
| 🟡 Médio | 10 |
| 🟢 Baixo | 5 |

Os 2 itens críticos são reais e ativos agora (não teóricos): a tabela
`report_reactions` está de fato expondo `user_id`/`ip_hash` de todo mundo
publicamente (confirmado com uma chamada real à REST API), e os 3
endpoints de cron falham **aberto** (autenticam qualquer chamador) se a
variável `CRON_SECRET` não estiver definida no ambiente de deploy.

---

## 🔴 Crítico

### C1. `report_reactions` expõe `user_id` e `ip_hash` de qualquer usuário publicamente

**Onde:** migração `026_user_reports.sql`, policy `reactions_public_read`
(`for select using (true)`).

**Confirmado ao vivo:** criei um relato e uma reação de teste diretamente
no banco, depois consultei com a anon key pública (a mesma que já está no
bundle do cliente, `NEXT_PUBLIC_SUPABASE_ANON_KEY`):

```bash
curl -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  "$SUPABASE_URL/rest/v1/report_reactions?select=*&id=eq.<id-de-teste>"

# Resposta (HTTP 200):
[{"id":"e257c397-...","report_id":"bf42a16a-...","user_id":null,
  "ip_hash":"teste_hash_auditoria_seguranca","reaction":"confirm",
  "created_at":"2026-07-24T01:28:10..."}]
```

Qualquer pessoa com a anon key (pública, está no JS do cliente) pode listar
**toda** a tabela `report_reactions` — `user_id` (o UUID da conta que
confirmou/negou um relato) e `ip_hash` (hash do IP de quem reagiu,
anônimo ou não) de qualquer usuário, sem nenhuma autenticação. O app hoje
não consome essa tabela diretamente do cliente (só os contadores
`confirmations`/`denials` já agregados em `user_reports`), então a UI em
si não vaza isso — mas o endpoint REST cru está aberto pra qualquer um que
saiba que a tabela existe.

**Impacto:** um usuário autenticado que confirma/nega relatos tem esse
histórico de atividade (quais relatos, quando) associável à própria conta
por qualquer pessoa externa. Não é uma credencial vazada, mas é dado de
comportamento de usuário exposto sem controle de acesso — está descrito
exatamente pela pergunta 2 do enunciado ("usuário pode ver notificações
de outros? não deveria" — mesma lógica se aplica aqui, mesmo não estando
na lista original de tabelas a checar).

**Correção proposta (não aplicada ainda):** trocar a policy de select por
algo como `using (auth.uid() = user_id or user_id is null)` só devolvendo
a própria reação, OU simplesmente remover a policy de select pública (o
app não precisa ler essa tabela do cliente hoje — os contadores já vêm
agregados em `user_reports`) e deixar leitura só via `pg` server-side se
algum dia for necessária.

---

### C2. Endpoints de cron autenticam qualquer chamador se `CRON_SECRET` não estiver configurada

**Onde:** `app/api/cron/scores/route.ts:77`, `app/api/cron/weather/route.ts:80`,
`app/api/cron/update/route.ts:77` — as 3 rotas repetem o mesmo padrão:

```typescript
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
}
```

Se `CRON_SECRET` não estiver definida no ambiente (variável ausente, erro
de digitação no nome, ou deploy numa plataforma nova sem os secrets
configurados ainda — o projeto já teve esse exato problema antes, ver
`scripts/SETUP_ACTIONS.md`), `process.env.CRON_SECRET` vira `undefined` e
a comparação passa a ser contra a string literal `"Bearer undefined"`.
Qualquer chamador que mande exatamente esse header **autentica com
sucesso**:

```bash
curl -H "Authorization: Bearer undefined" https://.../api/cron/scores
```

Isso é "falha aberta" (fail-open) numa rota que dispara recálculo nacional
de score ou consumo de cota das APIs de clima — em vez de "falha fechada"
(negar por padrão quando a config está ausente). Como o projeto tem **4
mecanismos diferentes** de disparo do cron (GitHub Actions, Vercel,
Netlify, agendador interno — ver `scripts/SETUP_ACTIONS.md`), o risco de
um deles estar configurado sem o secret em algum momento é concreto, não
hipotético.

**Correção proposta:** checar explicitamente que a env var existe antes de
comparar, e usar comparação timing-safe (ver item M8 abaixo):

```typescript
const expected = process.env.CRON_SECRET;
if (!expected || !timingSafeEqual(...)) {
  return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
}
```

---

## 🟡 Médio

### M1. Rate limiting contornável via spoofing de `X-Forwarded-For`

**Onde:** `getClientIp()`, duplicada em `app/api/reports/route.ts:18-22` e
`app/api/reports/[id]/react/route.ts:16-20`:

```typescript
function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
```

`X-Forwarded-For` é um header que o **cliente controla** — um proxy
confiável normalmente *adiciona* o IP real ao final da lista, não
substitui o que já veio. Pegar o primeiro item (`split(",")[0]`) pega
exatamente o valor que o próprio atacante pode ter forjado, não o IP real
adicionado pela borda confiável (Vercel/Netlify). Um atacante manda um
`X-Forwarded-For` diferente a cada requisição e:
- contorna o limite de 3 relatos anônimos/hora (`checkRateLimit` em
  `lib/reportRateLimit.ts`) — cada IP "novo" começa a contagem do zero;
- contorna a dedupe de reação por IP em `report_reactions` (o `unique
  (report_id, ip_hash)` só impede duas reações com o *mesmo* ip_hash).

**Impacto:** as duas defesas anti-spam do sistema de relatos (rate limit e
dedupe de reação) dependem inteiramente desse IP, e as duas são
contornáveis pelo mesmo vetor.

**Correção proposta:** usar o último IP da lista (o mais próximo da borda,
adicionado pelo proxy confiável), ou melhor — usar um header específico da
plataforma de deploy que não pode ser forjado pelo cliente (ex:
`x-vercel-forwarded-for` na Vercel, ou o IP que a própria plataforma
expõe via `req.ip` quando disponível).

### M2. Sem rate limit nenhum para usuários autenticados

`checkRateLimit` só roda quando `isAnonymous` é true (`app/api/reports/route.ts:61`).
Uma conta autenticada pode criar relatos ilimitados — o comentário no
código ("autenticados não têm limite... abuso de múltiplas contas já é
mais custoso") assume que criar conta é uma barreira significativa, mas
o cadastro no `/auth` não tem nenhum controle anti-automação (sem
captcha, sem rate limit próprio no Supabase Auth verificado aqui) — criar
várias contas programaticamente não é caro. O mesmo vale pra
`POST /api/reports/[id]/react` (nenhum rate limit, autenticado ou não,
além da dedupe por relato individual).

### M3. Sem rate limit em `POST /api/suggestions`

Qualquer chamador (autenticado ou não) pode enviar sugestões sem limite —
enche a tabela `user_suggestions` sem controle algum.

### M4. Mensagens de erro internas vazadas pro cliente

Padrão repetido em vários endpoints — o handler devolve `(err as
Error).message` direto no JSON de resposta:

- `app/api/reports/[id]/react/route.ts:93`
- `app/api/tide/route.ts:16`, `app/api/weather/route.ts:20`,
  `app/api/forecast/route.ts:18`, `app/api/score/route.ts:38`

Isso pode vazar detalhes de implementação (nomes de coluna/constraint do
Postgres, mensagens de erro de bibliotecas internas) pro cliente. Não
encontrei um caso onde isso exponha segredo (senha, connection string),
mas é informação interna que ajuda um atacante a entender a stack, e é
inconsistente com endpoints como `/api/reports` (POST), que não têm
try/catch nenhum ao redor das queries e dependem do tratamento padrão do
Next.js pra erros não capturados.

### M5. Nenhum header de segurança configurado

`next.config.mjs` não define `headers()` nenhum. Confirmado: sem
`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy` ou `Content-Security-Policy`. O app fica clicjack-
ável (pode ser embedado num iframe malicioso) e sem as proteções básicas
de MIME-sniffing/referrer.

### M6. Comparação do `CRON_SECRET` não é timing-safe

Mesmo depois de corrigir o fail-open (C2), a comparação `authHeader !==
\`Bearer ${secret}\`` usa `!==` simples, vulnerável a timing attack em
teoria (a diferença de tempo entre comparações que divergem cedo vs tarde
na string pode vazar informação sobre o segredo, byte a byte). Risco
prático baixo aqui (chamada HTTP via rede introduz jitter que dificulta
muito medir isso remotamente), mas é a prática recomendada e o enunciado
pediu explicitamente pra verificar.

### M7. `GET /api/health` exposta sem autenticação

Devolve % de uso de cota das APIs de clima (OpenMeteo/WeatherAPI) e
detalhes do último ciclo de cron (total de cidades, distribuição por
fonte de dado, timestamp exato de conclusão) pra qualquer chamador, sem
nenhum auth. Não é credencial, mas é informação operacional interna que
ajuda a entender quando o sistema está mais vulnerável a rate-limit
externo ou quando o próximo ciclo deve rodar.

### M8. `/api/history`: `state` não validado, e sem paginação na query do Supabase

- `state` é usado sem validação (`app/api/history/route.ts:30`) pra montar
  a key do B2 (`getRiskScoresKey`, `lib/b2.ts:72-75`): `` `risk_scores/${year}/${month}/${day}/scores_${date}_${state.toLowerCase()}.json.gz` ``.
  Testei mentalmente um path traversal clássico (`state=../../../etc`) —
  como S3/B2 trata a key como uma string opaca (não resolve `..` como
  filesystem faria), isso não vira leitura arbitrária de arquivo, só uma
  key "esquisita" que provavelmente não existe (404). Mas continua sendo
  falta de validação de input que o enunciado pediu explicitamente
  (`state` deveria ser sempre 2 letras maiúsculas).
- A query pro caminho "recente" (Supabase, `< 48h`) não tem `LIMIT`
  nenhum — devolve TODOS os `risk_scores` do estado no dia inteiro. Pra
  SP/RS isso já passou de 10-14 mil linhas num único request (visto ao
  vivo nesta sessão). Combinado com não ter rate limit, dá pra forçar
  queries caras repetidamente.

### M9. Sem limite de tamanho de payload nos endpoints POST

`POST /api/reports`, `POST /api/reports/[id]/react` e `POST
/api/suggestions` fazem `req.json()` sem nenhum limite de tamanho de
corpo configurado — o body inteiro é parseado pra memória antes de
qualquer validação de tamanho de campo rodar (ex: o limite de 280/1000
caracteres em `description` só é checado *depois* do JSON já estar
totalmente montado em memória). Não testei o limite de fato — Next.js
(App Router) não expõe um teto documentado simples pra Route Handlers
como tinha no Pages Router (`api.bodyParser.sizeLimit`); precisa
verificar/impor um teto explícito.

### M10. Validação inconsistente entre endpoints parecidos

- `lat`/`lng` em `POST /api/reports`: só checa `typeof === "number"`, sem
  checar o range (`-90..90`/`-180..180`). Impacto baixo (só falha em achar
  bairro próximo), mas é o oposto do que `/api/history` faz com `date`
  (regex explícito).
- `id` (o `reportId` da URL) em `POST /api/reports/[id]/react` não é
  validado como UUID antes de ir pra query — um valor malformado gera erro
  de cast do Postgres, capturado e vazado via M4.
- `start`/`end` em `GET /api/reports?state=` não têm o mesmo regex de
  formato que `/api/history` aplica em `date` — dependem só do cast
  `::date` do Postgres rejeitar (sem try/catch em volta, então um erro
  aqui também cai no comportamento padrão do Next.js pra exceção não
  tratada).

---

## 🟢 Baixo

### B1. `contact_email` em `/api/suggestions` sem validação de formato
Aceita qualquer string (só checa que é string). Não é vetor de ataque —
só qualidade de dado.

### B2. Next.js 14.2.35 com várias advisories conhecidas (`npm audit`)
8 vulnerabilidades altas reportadas, quase todas em `next` (DoS, cache
poisoning, SSRF em Server Actions/rewrites) e nas dependências do
`next-pwa` (`postcss`, `serialize-javascript` — via `workbox-build`,
efeito só em build, não runtime). Confirmei que o projeto **não usa**
middleware customizado nem Server Actions (`"use server"`) — as
advisories mais específicas a essas features provavelmente não se
aplicam, mas várias (DoS genérico, cache poisoning) valem pra qualquer
app Next.js na versão.

**Tentativa de correção (24/07/2026) — revertida, conflito documentado:**
tentei `npm install next@latest` (14.2.35 → 16.2.11). `npm install` e
`tsc --noEmit` passaram limpos, mas `npm run build` falhou:

```
⨯ ERROR: This build is using Turbopack, with a `webpack` config and no
   `turbopack` config. [...] As of Next.js 16 Turbopack is enabled by
   default and custom webpack configurations may need to be migrated
   to Turbopack.
```

Causa raiz: `next-pwa` (última versão publicada, 5.6.0 — sem releases
recentes) funciona injetando uma função `webpack()` customizada em
`next.config.mjs` pra gerar o service worker; Next.js 16 troca o
bundler padrão pra Turbopack e recusa buildar com uma config de webpack
"órfã" sem uma config equivalente de `turbopack` explícita. Não é um
bug no código deste projeto — é uma incompatibilidade real entre
`next-pwa` (parado, pré-Turbopack) e a mudança de bundler padrão do
Next 16.

Revertido: `package.json`/`package-lock.json` restaurados pro estado
commitado (Next 14.2.35), `.next/` limpo, `npm install` рodado de novo.
Confirmado depois do revert: `tsc --noEmit` limpo, dev server sobe
normal, os 5 headers de segurança (commit anterior) continuam
aparecendo na resposta.

Caminho pra atualizar no futuro: trocar `next-pwa` por uma alternativa
mantida (ex: `@ducanh2912/next-pwa`, fork ativo com suporte a
App Router/Turbopack) ou gerar o service worker manualmente, e só
então revisitar a atualização do Next. Não fazer isso como parte de uma
sessão de correções de segurança — é uma mudança de infraestrutura de
build separada, com escopo e teste próprios.

### B3. Nenhum GET tem rate limit
`/api/neighborhoods`, `/api/municipalities`, `/api/score`, `/api/weather`,
`/api/forecast`, `/api/tide`, `/api/history` — todos sem throttle. Os
bbox são limitados por `LIMIT` nas queries (exceto `/api/history`, ver
M8), então não é uma query "infinita", mas nada impede bater no endpoint
repetidamente.

### B4. `limit ${MAX_REPORTS_PER_REQUEST}` interpolado como string na query SQL
Em `GET /api/reports?state=` (`app/api/reports/route.ts:148`), o `LIMIT`
é montado por interpolação de template string em vez de bind parameter.
Hoje é seguro porque `MAX_REPORTS_PER_REQUEST` é uma constante do próprio
código (100), nunca vem do request — mas é um padrão frágil: se algum dia
alguém trocar isso por um limite vindo de query param sem perceber o
precedente, vira injeção de SQL real.

### B5. `IP_HASH_SALT` é um único salt estático, nunca rotacionado
Aceitável pro modelo de ameaça atual (o hash nunca é comparado/vazado em
lugar nenhum hoje), mas se esse salt específico algum dia vazar (commit
acidental, log), todo o histórico de `ip_hash` já gravado vira
reversível por força bruta contra o espaço de IPv4 (computacionalmente
barato). Não é urgente, só documentando o trade-off.

---

## O que já está correto (confirmado, não precisa de ação)

- **XSS via `description`:** não encontrei nenhum `dangerouslySetInnerHTML`
  ou `innerHTML` no projeto inteiro. O único lugar que monta HTML cru por
  string (popup de relato no mapa, `components/map/ReportLayer.tsx`)
  escapa `description` explicitamente via `escapeHtml()` antes de
  interpolar — confirmado lendo o código linha a linha. Resto do app
  renderiza texto de usuário como children do React (auto-escapado por
  padrão).
- **RLS em `risk_scores`:** só tem policy de leitura pública, nenhuma de
  escrita — testei ao vivo um INSERT com a anon key (neighborhood_id
  inexistente, seguro mesmo se a policy falhasse) e foi rejeitado com
  `42501 — new row violates row-level security policy` (HTTP 401).
- **`user_reports`:** sem policy de DELETE nenhuma (ninguém consegue
  deletar relato via REST, nem o próprio dono) — testei ao vivo: DELETE
  num relato de teste real não afetou nenhuma linha, e o UPDATE de
  status por um chamador anônimo (sem ser dono) também não afetou
  nenhuma linha, confirmando `reports_owner_update` funcionando.
- **`user_favorites`, `user_suggestions` (leitura), `notifications`:**
  todas restritas a `auth.uid() = user_id` — usuário não vê dado de
  outro usuário nessas 3 tabelas.
- **`system_locks` e `cron_run_stats`:** RLS habilitado e **zero
  policies** — mais restritivo ainda do que "só leitura pública" (nem
  isso): totalmente inacessível via REST API pra qualquer role client-side.
  Confirmado com `count(*)` direto no banco (tabelas não vazias) vs
  resposta `[]` da anon key.
- **Variáveis de ambiente:** só `NEXT_PUBLIC_SUPABASE_URL` e
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` têm o prefixo `NEXT_PUBLIC_` no projeto
  inteiro (grep confirmado) — nenhuma credencial sensível
  (`B2_KEY_ID`/`B2_APPLICATION_KEY`, `SUPABASE_CONNECTION_STRING`,
  `CRON_SECRET`, `IP_HASH_SALT`) está exposta ao bundle do cliente.
- **`/api/history`:** `date` é validado por regex (`^\d{4}-\d{2}-\d{2}$`)
  antes de qualquer uso.
- **`POST /api/neighborhoods`:** não existe — o endpoint só tem `GET`
  (leitura por bbox/id). Não há caminho de escrita nesse endpoint.

---

## Tabela completa de policies (consulta ao vivo, 24/07/2026)

```
tablename          | policyname                | cmd    | qual
--------------------|----------------------------|--------|---------------------------
cities              | cities_public_read         | SELECT | true
historical_events   | historical_events_public_read | SELECT | true
merge_cache         | merge_cache_public_read    | SELECT | true
municipalities      | municipalities_public_read | SELECT | true
neighborhoods       | neighborhoods_public_read  | SELECT | true
notifications       | notifications_own          | SELECT | auth.uid() = user_id
report_reactions    | reactions_anyone_insert    | INSERT | (check: true)
report_reactions    | reactions_public_read      | SELECT | true   <-- C1
risk_events         | risk_events_public_read    | SELECT | true
risk_scores         | risk_scores_public_read    | SELECT | true
tide_cache          | tide_cache_public_read     | SELECT | true
user_favorites      | favorites_own              | ALL    | auth.uid() = user_id
user_reports        | reports_anyone_insert      | INSERT | (check: true)
user_reports        | reports_owner_read         | SELECT | auth.uid() = user_id
user_reports        | reports_public_read        | SELECT | status = 'active'
user_reports        | reports_owner_update       | UPDATE | auth.uid() = user_id
user_suggestions    | suggestions_anyone_insert  | INSERT | (check: true)
user_suggestions    | suggestions_owner_read     | SELECT | auth.uid() = user_id
weather_cache       | weather_cache_public_read  | SELECT | true

Tabelas com RLS habilitado e ZERO policies (inacessíveis via REST):
city_risk_summary, cron_run_stats, system_locks
```

---

## Testes ao vivo executados (seção 3 do pedido)

Todos usando a `NEXT_PUBLIC_SUPABASE_ANON_KEY` real do projeto.

| Teste | Resultado | Avaliação |
|---|---|---|
| `GET user_suggestions` | `[]` HTTP 200 | ✅ Correto (RLS filtra por dono, anon não tem dono) |
| `GET report_reactions` (com linha de teste real presente) | **linha completa retornada**, incluindo `user_id`/`ip_hash` | 🔴 C1 |
| `GET system_locks` | `[]` HTTP 200 (tabela tem linhas, confirmado via SQL direto) | ✅ Correto — RLS bloqueia tudo |
| `GET cron_run_stats` | `[]` HTTP 200 (idem) | ✅ Correto |
| `POST risk_scores` (INSERT) | `42501 row-level security policy` HTTP 401 | ✅ Correto |
| `DELETE user_reports?id=eq.<real>` | `[]` HTTP 200, linha **não foi apagada** (confirmado via SQL) | ✅ Correto — sem policy de DELETE |
| `PATCH user_reports?id=eq.<real>` (status, sem ser dono) | `[]` HTTP 200, status **não mudou** (confirmado via SQL) | ✅ Correto |

Todos os dados de teste criados pra esses testes foram removidos do banco
ao final.

---

## Próximos passos

Nada foi corrigido ainda. Aguardando aprovação pra priorizar e aplicar as
correções — sugestão de ordem: C1 e C2 primeiro (críticos, correção
rápida e isolada), depois M1/M2/M3 (rate limiting, mesmo padrão em 3
lugares), M4/M5 (hardening geral), resto conforme prioridade do time.
