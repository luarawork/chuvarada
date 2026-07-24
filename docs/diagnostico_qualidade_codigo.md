# Diagnóstico de qualidade de código — Chuvarada

**Status:** diagnóstico apenas — nada foi alterado. Aguardando aprovação para corrigir.
**Data:** 24/07/2026
**Contexto:** deploy alvo é Vercel; múltiplos colaboradores podem entrar no projeto no futuro.

---

## Achado mais importante: o build de produção falha hoje

```
npx next build
...
Failed to compile.

./components/panel/ForecastStrip.tsx
146:9  Error: `"` can be escaped with `&quot;`, `&ldquo;`, `&#34;`, `&rdquo;`.  react/no-unescaped-entities
146:17  Error: `"` can be escaped with `&quot;`, `&ldquo;`, `&#34;`, `&rdquo;`.  react/no-unescaped-entities
```

`next build` roda ESLint por padrão e a regra `react/no-unescaped-entities` trava em aspas retas dentro de JSX (`"% chuva"` em texto solto, [ForecastStrip.tsx:146](../components/panel/ForecastStrip.tsx:146)). Isso **não é um nit de estilo — o build inteiro para aqui**, antes até de gerar a tabela de tamanho de rotas. Por causa disso, a seção 11 (tamanho de bundle) deste relatório não tem números reais: o build aborta no lint antes de chegar lá. Corrigir isso é pré-requisito para qualquer deploy na Vercel, não uma refatoração opcional — ver prioridade P0 no final.

---

## 1. Estrutura de pastas

Estrutura completa (excluindo `node_modules`, `.next`, `dados-brutos`):

```
app/
  analise/page.tsx  auth/page.tsx  como-funciona/page.tsx  favoritos/page.tsx
  perfil/page.tsx  page.tsx  layout.tsx  globals.css
  api/
    cron/{scores,update,weather}/route.ts
    forecast, health, history, municipalities, neighborhoods, score,
    suggestions, tide, weather /route.ts
    reports/route.ts  reports/[id]/react/route.ts
components/
  how-it-works/ (3)  map/ (5)  panel/ (4)  ui/ (13)
hooks/ (8)
lib/ (21)
types/index.ts
scripts/ (~55 arquivos entre .py/.js/.ts/.md/.sql/.csv/.json)
netlify/functions/scheduled-cron.mts
instrumentation.ts
public/geojson/ (~50 arquivos)
.github/workflows/ (3)
```

**Segue as convenções do App Router?** Sim — rotas em `app/`, route handlers em `app/api/*/route.ts`, sem mistura de Pages Router. `tsconfig.json` já tem o alias `@/*` e é usado em 100% dos imports internos (não há nenhum `../../../..` no projeto).

**Arquivos mal posicionados:**
- [diagnostico_cobertura.md](diagnostico_cobertura.md) está na **raiz** do repo, enquanto todos os outros ~9 relatórios `diagnostico_*.md` e `relatorio_*.md` estão em `scripts/`. Inconsistente, sem motivo aparente — deveria estar junto dos demais.
- Três mecanismos de cron coexistem no repo: `vercel.json` (Vercel Cron), [netlify/functions/scheduled-cron.mts](../netlify/functions/scheduled-cron.mts) (Netlify) e `lib/internalScheduler.ts` + `instrumentation.ts` (servidor persistente tipo Railway/Render). Isso foi uma decisão deliberada de manter o projeto portável entre plataformas — mas como o deploy definitivo é Vercel, `netlify/functions/` e o caminho do `internalScheduler` são código morto nesse ambiente. Para um colaborador novo, ter 3 formas de disparar o mesmo cron sem indicação de qual é "a que vale" é uma fonte real de confusão.
- Não há pasta `/tests` nem nenhum arquivo `*.test.ts`/`*.spec.ts` em todo o projeto — zero cobertura de teste automatizado.

**Nomes de pasta inconsistentes:** nenhum encontrado — `how-it-works`, `map`, `panel`, `ui` são coerentes entre si (kebab-case), e `components/lib/hooks/types` seguem a convenção padrão do ecossistema Next.

**Scripts de dev misturados com produção:** sim, ver seção 9.

---

## 2. Duplicação de código

- **`getUserIdFromAuthHeader` triplicada, byte-a-byte idêntica**, em [app/api/reports/route.ts:20](../app/api/reports/route.ts:20), [app/api/reports/\[id\]/react/route.ts:18](../app/api/reports/%5Bid%5D/react/route.ts:18) e [app/api/suggestions/route.ts:14](../app/api/suggestions/route.ts:14). Deveria virar uma função em `lib/auth.ts` (que já existe e já tem `verifyCronSecret`).
- **Lock de execução do cron triplicado** entre as 3 rotas de cron ([scores](../app/api/cron/scores/route.ts:32), [weather](../app/api/cron/weather/route.ts:38), [update](../app/api/cron/update/route.ts:53)): `isAlreadyRunning`/`acquireLock`/`releaseLock` (ou `isCronAlreadyRunning`/`acquireCronLock`/`releaseCronLock`) são a mesma lógica contra `system_locks`, mudando só o nome da chave e o `locked_by`. Boa candidata a um `lib/systemLock.ts` genérico (`acquireLock(db, key, owner)` etc).
- **`MERGE_MAX_AGE_HOURS = 6`** definida de forma idêntica em [lib/merge.ts:24](../lib/merge.ts:24) e [lib/weather.ts:13](../lib/weather.ts:13) — mesmo nome, mesmo valor, dois arquivos. Se um dia precisar mudar, é fácil esquecer um dos dois.
- **`LOCK_MAX_AGE_MINUTES` com 3 valores diferentes** (10, 15, 25 min) nas 3 rotas de cron — não é bug, mas reforça que a lógica de lock deveria estar centralizada com o TTL como parâmetro, não reimplementada.
- **Tratamento de erro inconsistente** entre endpoints — ver seção 6, é o achado mais relevante desta seção.
- Constantes como `MAX_DESCRIPTION_LENGTH` existem em `app/api/reports/route.ts` (280) e `app/api/suggestions/route.ts` (1000) com valores diferentes — não é duplicação de fato (são limites de domínios diferentes), mas nenhuma delas está num arquivo de constantes central; hoje é preciso abrir cada route handler pra saber os limites vigentes.
- Nenhuma query Supabase relevante duplicada: o acesso ao `pg` já está centralizado em `lib/db.ts` (`getDb()`), e o cliente Supabase em `lib/supabase.ts` (`getServerSupabase()`) — ambos importados corretamente em todo lugar, sem nenhuma instância "solta" de `createClient`/`new Pool`.

---

## 3. Tipos TypeScript

```
npx tsc --noEmit --strict
```
**0 erros.** `tsconfig.json` já roda com `"strict": true` normalmente (confirmado — não foi preciso relaxar nada pra passar).

- `any` aparece em **apenas 2 lugares** em todo o projeto: `payload?: any` em [app/analise/page.tsx:99](../app/analise/page.tsx:99) (tipo de um evento de tooltip do Recharts — a lib não exporta um tipo público fácil de usar aqui, então é defensável) e `function buildResponse(rows: any[])` em [app/api/neighborhoods/route.ts:107](../app/api/neighborhoods/route.ts:107) (linhas cruas vindas do `pg`, antes de mapear pro shape tipado — também comum nesse padrão, mas dava pra tipar como `Record<string, unknown>[]` ou uma interface de linha crua).
- Tipos de domínio (schema do banco: `City`, `Neighborhood`, `RiskScore`, `UserReport`, `WeatherCache`, `TideCache` etc.) estão **bem centralizados** em [types/index.ts](../types/index.ts) e batem com o schema real (`scripts/sql/*.sql`) nos campos que verifiquei. Interfaces de `Props` de componente ficam localmente no próprio arquivo do componente — isso é o padrão idiomático em React/Next, não uma inconsistência.
- Nenhum tipo duplicado entre `types/index.ts` e os `lib/*.ts` — os `interface`s locais em `lib/weather.ts`, `lib/cptec.ts` etc. (`RainReading`, `OpenMeteoResponse`, `CachedTideRow`...) são formatos internos de API externa ou de linha de cache, não duplicatas dos tipos de domínio.

**Conclusão desta seção: não há nada a corrigir aqui.** É o ponto mais forte do projeto.

---

## 4. Qualidade dos componentes React

| Arquivo | Linhas | Observação |
|---|---|---|
| [app/page.tsx](../app/page.tsx) | 535 (componente `HomePage` ≈ 406) | 11 `useEffect`, 6 `useMemo`, 0 `useCallback`. Mistura estado de zoom/modo do mapa, fetch de bairros/municípios/relatos por viewport, e merge de scores em tempo real tudo no componente de página. Forte candidato a extrair pra hooks (`useMapViewport`, `useNeighborhoodsForBounds`) |
| [app/analise/page.tsx](../app/analise/page.tsx) | 618 (componente ≈ 394) | Já extrai helpers de módulo (`buildHourlyComparison`, `computeAlignmentMetrics`, `dateRange`) para fora do componente — boa prática — mas esses helpers são lógica de negócio (cálculo de alinhamento relato vs. modelo) que deveria morar em `lib/`, não em um arquivo de página |
| [components/ui/SearchBar.tsx](../components/ui/SearchBar.tsx) | 224 | Maior componente de `components/`, ok para o que faz (busca + debounce + lista de resultados) |
| [components/ui/SuggestionModal.tsx](../components/ui/SuggestionModal.tsx) | 163 | Faz `fetch()` direto no componente — o projeto já tem o padrão de hooks (`useReports`, `useFavorites`, `useForecast`) pra isso; aqui quebra a própria convenção |
| [components/map/EmptyStateLayer.tsx](../components/map/EmptyStateLayer.tsx) | 71 | Mesmo caso: `fetch()` inline em vez de um hook |

Demais componentes (24 no total) estão todos abaixo de 140 linhas, com props tipadas via `interface` local — nenhum problema estrutural encontrado neles.

**Resumo:** o problema não é "componentes grandes demais" no geral (só 2 páginas são grandes), é que a lógica de fetch/transformação de dados está espalhada entre hooks (bom, é o padrão dominante) e alguns componentes/páginas que não seguem esse mesmo padrão (pontos de inconsistência, não simplesmente "errado").

---

## 5. Camada de dados (lib/)

| Arquivo | Linhas | Observação |
|---|---|---|
| [lib/weather.ts](../lib/weather.ts) | 717 | De longe o maior arquivo do projeto. A função `getWeatherForPoint` sozinha tem **193 linhas** — implementa as 4 camadas de fallback (Open-Meteo → WeatherAPI → cache → neutro) num único corpo de função. Funciona e está bem comentado, mas é difícil de testar isoladamente e de acompanhar o fluxo. Boa candidata a quebrar em uma função por camada + um orquestrador curto |
| [lib/cptec.ts](../lib/cptec.ts) | 248 | Funções pequenas e coesas (nenhuma passa de ~50 linhas) |
| [lib/riskScoring.ts](../lib/riskScoring.ts) | 171 | ok |
| [lib/merge.ts](../lib/merge.ts) | 103 | ok |
| Demais 17 arquivos | 15–134 linhas | Nenhum outro passa de 50 linhas por função — responsabilidade única bem respeitada |

- Acesso a dados **centralizado**: `getDb()` (Postgres direto) e `getServerSupabase()`/`supabase` (Supabase) são os únicos pontos de entrada, sem instâncias soltas.
- Tratamento de erro: dentro de `lib/`, a maioria das funções deixa o erro propagar (correto — quem decide como responder ao cliente é a camada de rota, não a lib). Onde isso é tratado localmente (`.catch(() => null)` em pontos de fallback como Open-Meteo/WeatherAPI) é intencional e documentado.
- Testabilidade: como não há testes hoje, isso é teórico, mas a maior parte das funções de `lib/` recebe parâmetros explícitos e não depende de estado de módulo — exceção parcial ao rate limiter em memória (`lib/rateLimiter.ts`, usado por `weather.ts`/`weatherapi.ts`), que teria que ser mockado/reiniciado entre testes.

---

## 6. Endpoints de API (app/api/)

Este é o achado de maior impacto prático da seção de endpoints: **o padrão de tratamento de erro é inconsistente entre rotas**, mesmo depois da correção de segurança M4 (não vazar `err.message`).

| Rota | Usa `handleApiError` no catch? |
|---|---|
| `forecast`, `score`, `tide`, `weather`, `reports/[id]/react` | ✅ Sim |
| `reports` (GET/POST), `suggestions`, `history` | ❌ Não tem `try/catch` nenhum ao redor das queries — se o banco falhar (e isso *aconteceu de verdade* durante os testes desta sessão, ver os `ETIMEDOUT` intermitentes documentados em `docs/relatorio_vulnerabilidades.md`), a exceção sobe crua para o Next, que decide como responder |
| `municipalities`, `neighborhoods`, `health` | ❌ Idem — nenhum try/catch |
| `cron/*` (3 rotas) | Têm seu próprio `try/catch` por cidade dentro do loop (correto para não derrubar o ciclo inteiro por uma cidade), mas a rota como um todo não tem um catch externo |

Ou seja: a correção M4 tapou o vazamento de mensagem só nos 5 endpoints que já usavam esse padrão antes — os outros 6 endpoints (incluindo os 3 mais usados pelo mapa: `neighborhoods`, `municipalities`, `reports`) continuam sem rede de segurança nenhuma contra erro de banco.

- **Padrão validação → auth → lógica → resposta:** seguido de forma razoavelmente consistente onde existe validação (reports, suggestions, history) — auth vem antes da lógica de negócio em todas as rotas que precisam dela.
- **Nenhum endpoint faz "coisa demais"** a ponto de precisar ser dividido — o maior é `cron/update` (168 linhas) e `reports` (190 linhas), ambos coesos para o que fazem.
- **Middleware compartilhado:** `rejectIfPayloadTooLarge`, `getClientIp`, `hashIp`, `parseBbox`, `isValidBrazilState`, `verifyCronSecret` já são bem reaproveitados entre rotas (produto direto da rodada de correções de segurança).

---

## 7. Configuração e ambiente

- **Não existe `.env.local.example`** — só `.env.local` (git-ignorado, correto). Para um colaborador novo, não há nenhum arquivo no repo que liste quais variáveis são necessárias para rodar o projeto; hoje isso só existe implicitamente espalhado pelos comentários dentro do próprio `.env.local` de quem já tem o projeto rodando.
- **Variável morta:** `OPENWEATHERMAP_API_KEY` ainda está em `.env.local`, mas não é referenciada em nenhum lugar do código — resquício da migração para Open-Meteo (task #69 do histórico do projeto). Não afeta nada, mas é uma pista falsa para quem for configurar o ambiente do zero.
- **`next.config.mjs`:** organizado e comentado (o comentário explica explicitamente por que a CSP foi deixada de fora por enquanto). Sem problema aqui.
- **`tsconfig.json`:** tem o alias `@/*` configurado e 100% dos imports internos o utilizam — não há nenhum `../../../..`.
- **Vercel:** `vercel.json` só declara o cron de `/api/cron/update` a cada hora — os cron de `scores`/`weather` aparentemente dependem de outro disparo (não investiguei isso a fundo aqui pois está fora do escopo de "qualidade de código", mas vale checar antes do deploy se a orquestração entre os 3 crons está de fato coberta só pela Vercel).

---

## 8. Convenções de código

- **Nomenclatura:** 100% consistente — componentes em PascalCase (`SearchBar.tsx`, `ReportModal.tsx`...), `lib/`/`hooks/` em camelCase (`reportRateLimit.ts`, `useFavorites.ts`...). Nenhuma exceção encontrada.
- **Imports:** organizados de forma consistente (externos → `@/` → relativos) em todos os arquivos amostrados.
- **Comentários:** 100% em português em toda a base — nenhuma mistura de idioma encontrada.
- **`console.log` esquecido:** só 2 ocorrências em todo o projeto, ambas em [lib/internalScheduler.ts:29](../lib/internalScheduler.ts:29) e [:35](../lib/internalScheduler.ts:35), e são logging operacional intencional (não debug esquecido) — mas vale considerar se deveriam usar `console.error`/um logger estruturado em vez de `console.log`, já que é o único lugar do projeto usando esse método diretamente.

**Conclusão: convenções muito bem seguidas, nada a corrigir aqui.**

---

## 9. Scripts de manutenção

`scripts/` tem ~55 arquivos somando **4.271 linhas** de `.py`/`.js`/`.ts`, mais 14 arquivos de `.md`/`.csv`/`.json`. Classificação:

**Produção / infraestrutura mantida (manter no repo, são referenciados pelo CI):**
- `fetch_merge_cptec.py` ([merge-and-scores-update.yml](../.github/workflows/merge-and-scores-update.yml))
- `archive_to_b2.ts` ([archive-history.yml](../.github/workflows/archive-history.yml))
- `run_migrations.js`, `sql/001..030_*.sql` (histórico de migração — deve continuar sendo versionado permanentemente, mesmo as antigas)
- `README_deploy_agendadores.md`, `README_merge.md`, `SETUP_ACTIONS.md` (documentação de operação)
- `requirements.txt`

**Pipeline de dados reutilizável (mantido — roda de novo sempre que uma cidade/estado nova entra):**
`process_bho.py`, `process_hydro_recife.py`, `process_hydro_sergipe.py`, `process_municipalities.py`, `process_neighborhoods.py`, `process_s2id.py`, `process_srtm.py`, `process_state_neighborhoods.py`, `process_inmet_extremes.py`, `coastal_hydro_proximity.py`, `compute_slope_for_geometries.py`, `merge_srtm_quadrants.py`, `upload_municipalities.js`, `upload_neighborhoods.js`, `upload_state_expansion.js`, `download_srtm_patch.js`, `download_srtm_states.js`, `download_srtm_states_retry.js`, `export_cities_csv.js`, `generate_icons.js`, `test_b2_connection.ts`

**One-time fix/backfill — já cumpriram o papel, candidatos a arquivar ou remover:**
`assign_tide_by_proximity.js`, `backfill_city_risk_summary.js`, `backfill_geometry_simplified.js`, `backfill_name_source.js`, `backfill_neighborhood_centroids.js`, `backfill_terrain_slope.js`, `fix_areia_branca_tide_code.js`, `fix_fernando_de_noronha_tide.js`, `fix_hydro_proximity_bbox.js`, `fix_hydro_proximity_coastal.js`, `fix_hydro_sergipe_local.js`, `fix_sao_luis_neighborhood.js`, `fix_terrain_slope_placeholders.js`, `diagnostico_expansao_nacional.js`, `import_historical_events.js`, `import_inmet_events.js`

**Relatórios/diagnósticos históricos (documentação, não código — poderiam ir para uma pasta `docs/` ou `scripts/relatorios/` em vez de misturados com os `.py`/`.js`):**
`diagnostico_cobertura.md` (na raiz, ver seção 1), `diagnostico_cobertura_sul_sudeste.md`, `diagnostico_cron_arquitetura.md`, `diagnostico_estados_lacunas.md`, `diagnostico_expansao_nacional.md`, `diagnostico_granularidade_sul_sudeste.md`, `diagnostico_panorama_cidades.csv`, `relatorio_testes_pos_correcao.md`, `relatorio_testes_pre_deploy.md`, `relatorio_vulnerabilidades.md`, `proposta_integracao_merge_cptec.md`, `inmet_extreme_events.json`

Para um colaborador novo, olhar `scripts/` hoje não deixa óbvio quais dos ~40 arquivos de código ainda importam vs. quais já cumpriram seu papel — não tem como saber sem ler o conteúdo de cada um.

---

## 10. Dependências

```
npm outdated
```

| Pacote | Atual | Última | Risco de atualizar |
|---|---|---|---|
| next, eslint-config-next | 14.2.35 | 16.2.11 | **Bloqueado** — já tentado e revertido nesta mesma auditoria (ver `relatorio_vulnerabilidades.md`, seção B2): `next-pwa` injeta webpack config incompatível com Turbopack do Next 16 |
| react, react-dom | 18.3.1 | 19.2.x | Major, não testado — provavelmente também trava por causa do `next-pwa`/outras libs (leaflet, recharts) que podem não suportar React 19 ainda |
| typescript | 5.9.3 | 7.0.2 | Major muito grande, avaliar com calma |
| eslint | 8.57.1 | 10.7.0 | Major — `eslint-config-next` 14.x trava em ESLint 8, então essa atualização também está presa até o Next ser resolvido |
| tailwindcss | 3.4.19 | 4.3.3 | Major, envolve migração de config, não trivial |
| @supabase/supabase-js, postcss, recharts | patch/minor | — | Seguros de atualizar isoladamente |

```
npm audit
```
**11 vulnerabilidades de severidade alta.** A maioria (next, postcss embutido no next, glob via eslint-config-next) só é corrigida atualizando para `next@16` — ou seja, estão presas atrás do mesmo bloqueio do `next-pwa` já documentado. Uma delas (`fast-uri`) tem fix direto via `npm audit fix` sem breaking change. Outra (`serialize-javascript`, via `next-pwa`→`workbox-build`) só sai trocando o `next-pwa` por uma alternativa mantida (`@ducanh2912/next-pwa`), como já recomendado no relatório de segurança.

**Dependências não utilizadas** (zero import em todo `app/`, `lib/`, `components/`, `hooks/`):
- `@supabase/auth-helpers-nextjs` — pacote **descontinuado** pela própria Supabase (substituído por `@supabase/ssr`), 0 usos — candidato claro a remover do `package.json`.
- `geotiff` — 0 usos em TypeScript. Provavelmente usado pelos scripts Python via outra lib (GDAL/rasterio), não pelo `geotiff` do npm — se for esse o caso, é uma dependência JS órfã.

---

## 11. Tamanho do bundle

```
npx next build
```
**Não foi possível medir** — o build falha no passo de lint antes de chegar à etapa que imprime o tamanho das rotas (ver "achado mais importante" no topo deste relatório). Depois de corrigir o [ForecastStrip.tsx:146](../components/panel/ForecastStrip.tsx:146), vale rodar de novo e checar a tabela de tamanhos.

Avaliação qualitativa possível mesmo sem os números: nenhum route handler importa dependências pesadas (`@turf/turf`, `sharp`, `geotiff`, `leaflet`) — essas ficam restritas a `lib/score.ts`/scripts Python/componentes de mapa (client-side). Os route handlers de `app/api/` usam só `pg`, `@supabase/supabase-js` e `cheerio` (este último só em `lib/cptec.ts`, usado pela rota de tide). Não há indício de risco de aproximar do limite de 50MB por função serverless da Vercel — mas isso deveria ser confirmado com o build real depois do fix do lint.

---

## 12. Relatório consolidado

### O que está bem (não precisa mudar)
- **Zero erros de TypeScript em modo `--strict`**, e o projeto já roda `strict: true` normalmente.
- Uso de `any` é praticamente inexistente (2 ocorrências, ambas defensáveis).
- Tipos de domínio centralizados em `types/index.ts`, batendo com o schema real.
- Convenções de nomenclatura (PascalCase/camelCase), organização de imports e idioma dos comentários (português) 100% consistentes em toda a base.
- Acesso a dados já centralizado (`getDb()`/`getServerSupabase()`) — nenhuma instância solta de client.
- Estrutura de `app/` segue o App Router corretamente, aliases `@/*` usados em todo lugar (nenhum import relativo longo).
- Middleware de segurança (`rejectIfPayloadTooLarge`, `getClientIp`, `verifyCronSecret` etc.) já bem reaproveitado entre rotas.

### Refatoração leve (< 1h por item)
1. **Corrigir o build quebrado** — escapar as aspas em [ForecastStrip.tsx:146](../components/panel/ForecastStrip.tsx:146) (`&quot;` ou trocar por aspas curvas). *(ver nota de prioridade abaixo — isto é P0, não apenas "leve")*
2. Extrair `getUserIdFromAuthHeader` (triplicada) para `lib/auth.ts`.
3. Mover [diagnostico_cobertura.md](diagnostico_cobertura.md) da raiz para `scripts/`, junto dos demais.
4. Remover `@supabase/auth-helpers-nextjs` e `geotiff` do `package.json` (0 usos).
5. Remover `OPENWEATHERMAP_API_KEY` de `.env.local` (variável morta).
6. Criar `.env.local.example` documentando as ~15 variáveis usadas.
7. Rodar `npm audit fix` (corrige `fast-uri` sem breaking change).
8. Deduplicar `MERGE_MAX_AGE_HOURS` entre `lib/merge.ts` e `lib/weather.ts`.

### Refatoração significativa (> 1h por item)
1. **Consolidar tratamento de erro** nos 6 endpoints sem `try/catch` (`reports`, `suggestions`, `history`, `municipalities`, `neighborhoods`, `health`) usando `handleApiError` — hoje um erro de banco (já observado de verdade nesta sessão) sobe cru nesses endpoints.
2. **Extrair o lock de `system_locks`** (triplicado nas 3 rotas de cron) para um `lib/systemLock.ts` genérico.
3. **Quebrar `getWeatherForPoint`** (193 linhas, `lib/weather.ts`) em uma função por camada de fallback + um orquestrador.
4. **Extrair lógica de `app/page.tsx`** (componente de ~406 linhas, 11 `useEffect`) para hooks dedicados de viewport/fetch.
5. **Mover os helpers de negócio de `app/analise/page.tsx`** (`buildHourlyComparison`, `computeAlignmentMetrics`) para `lib/`.
6. **Decidir a estratégia de cron para produção** (Vercel puro vs. os 3 mecanismos coexistentes) e remover/isolar claramente o que não for usado — `netlify/functions/` e o caminho `internalScheduler`/`instrumentation.ts` se o alvo for só Vercel.
7. **Adicionar alguma cobertura de teste automatizado** — hoje é zero; mesmo um punhado de testes unitários em `lib/score.ts`/`lib/riskScoring.ts` (lógica pura, fácil de testar) já destravaria colaboração futura com mais segurança.
8. Resolver o bloqueio do `next-pwa` vs. Next 16 (trocar por `@ducanh2912/next-pwa` ou service worker manual) para poder atualizar Next/React/ESLint/Tailwind e fechar as 11 vulnerabilidades de `npm audit`.

### O que deveria ser removido
- 16 scripts one-time de fix/backfill em `scripts/` que já cumpriram o papel (listados na seção 9) — mover para um branch/tag de arquivo, ou pelo menos para uma subpasta `scripts/one-off/` deixando claro que não devem rodar de novo.
- `@supabase/auth-helpers-nextjs` e `geotiff` do `package.json` (dependências sem uso).
- `OPENWEATHERMAP_API_KEY` de `.env.local`.
- Considerar mover os 12 arquivos de relatório/diagnóstico (`.md`/`.csv`/`.json`) de `scripts/` para uma pasta `docs/` dedicada, separando "código que roda" de "documentação histórica".

### Prioridade recomendada antes do deploy

| Ordem | Item | Motivo |
|---|---|---|
| **P0** | Corrigir `ForecastStrip.tsx:146` (aspas no JSX) | **O build falha hoje.** Sem isso não há deploy na Vercel, ponto final. |
| P1 | Tratamento de erro consistente nos 6 endpoints sem try/catch | Já houve erro de banco real e intermitente nesta sessão (`ETIMEDOUT`) — sem catch, isso vira 500 malformado em produção em vez de uma resposta controlada |
| P1 | `.env.local.example` + remover variável morta | Bloqueador direto para qualquer colaborador novo conseguir rodar o projeto |
| P2 | Deduplicar `getUserIdFromAuthHeader` e o lock de cron | Baixo risco, alto ganho de manutenibilidade para quem mexer nesses arquivos depois |
| P2 | Limpar dependências não usadas + `npm audit fix` | Reduz superfície de ataque e ruído no `npm install` sem exigir decisão de arquitetura |
| P3 | Categorizar/mover scripts one-off | Cosmético, mas ajuda muito um colaborador novo a não perder tempo lendo scripts mortos |
| P3 | Extrair `getWeatherForPoint` e a lógica de `app/page.tsx`/`app/analise/page.tsx` | Maior esforço, sem risco de segurança — pode esperar um ciclo de refatoração dedicado pós-deploy |
| P4 | Decidir estratégia de cron única + trocar `next-pwa` + atualizar Next/React | Mudanças estruturais maiores, cada uma merece sua própria sessão dedicada e testada isoladamente (como já foi feito e documentado na tentativa revertida do Next 16) |
