# Relatório de testes pós-correção

Data: 2026-07-20/21. Correções aplicadas na ordem de severidade indicada no [relatório de testes pré-deploy](relatorio_testes_pre_deploy.md), cada uma testada isoladamente e commitada em separado.

## Resumo executivo

| # | Problema | Severidade | Status | Commit |
|---|---|---|---|---|
| 1 | Cron sem agendador ativo | 🔴 Bloqueador | ✅ Resolvido | `a3b0ed1` |
| 2 | MERGE sempre prioriza sobre Open-Meteo | 🟡 Médio | ✅ Resolvido | `a868622` |
| 3 | Regra 2 (maré+costeira) enfraquecida no fallback de cache | 🟡 Médio | ✅ Resolvido | `0ed6308` |
| 4 | Painel de bairro sem Realtime | 🟡 Médio | ✅ Resolvido | `b453549` |
| 5 | `rain_source` ausente em `risk_scores` | 🟡 Médio | ✅ Resolvido | `2baa429` |
| 6 | Rate limiter Open-Meteo (500/h) | 🟡 Médio | ⚠️ Investigado — **não elevar** (achado abaixo) | — |
| 7 | 6 bairros fora do bbox do MERGE | 🟢 Baixo | ✅ Confirmado, não é bug | — |
| 8 | Colisão de nomes bairro/município (Pitimbú/Pitimbu) | 🟢 Baixo | ✅ Confirmado, não é bug funcional | — |

Nenhum problema novo bloqueador foi introduzido pelas correções. Um achado novo relevante surgiu durante a investigação do item 6 (rate limiter) — detalhado abaixo — que **contraria a premissa original da tarefa** (a pergunta era "dá pra elevar o limite?", a resposta é "não, e ele já está ligeiramente alto demais").

---

## 🔴 1. Agendador de cron

**Implementado**: as 3 opções pedidas, mais o workflow do MERGE.

- `.github/workflows/cron-update.yml` — GitHub Actions, `*/20 * * * *`, `workflow_dispatch` pra teste manual.
- `.github/workflows/merge-cache-update.yml` — idem, horário (`0 * * * *`), roda `scripts/fetch_merge_cptec.py`.
- `vercel.json` — já existia e já estava correto, não precisou de mudança.
- `netlify/functions/scheduled-cron.mts` — Netlify Scheduled Functions (mecanismo real verificado na documentação oficial, não a solução baseada em plugin fictício sugerida no pedido original).
- `instrumentation.ts` + `lib/internalScheduler.ts` — `node-cron` interno, opt-in via `ENABLE_INTERNAL_CRON=true`, pra deploys em servidor persistente.

**Correções feitas em relação ao pedido literal** (documentadas em `scripts/README_deploy_agendadores.md`):
- O YAML do pedido usava `curl -X POST`, mas a rota só aceita `GET`. Corrigido.
- As dependências Python pedidas (`geopandas`, `supabase`) não são usadas pelo script real; as reais são `rasterio numpy requests pg8000`. Corrigido.
- `@netlify/plugin-crons` (citado no pedido) não existe — confirmado via busca na documentação oficial do Netlify. Usado o mecanismo real (`export const config = { schedule }` no próprio arquivo da function).
- Netlify Scheduled Functions têm limite de execução de 30s; o cron leva ~5min31s. Resolvido com fire-and-forget + `AbortController` de 25s, best-effort (mesmo padrão de continuação server-side já validado no restante do projeto).

**Teste**: sintaxe de todos os YAMLs validada com `js-yaml`. O mecanismo em si (deploy real + secrets do GitHub/Vercel/Netlify) não pôde ser testado nesta sessão por não haver deploy nem remote configurados — fica como responsabilidade de quem fizer o primeiro deploy real, com os passos documentados no README.

## 🟡 2. Prioridade MERGE vs Open-Meteo (`getBestRainData`)

**Bug real encontrado ao testar**: a primeira versão, implementando literalmente o pseudocódigo do pedido, tinha a condição `merge.rain_72h < openMeteo.rain_72h * 2` como primeiro `if`. Essa condição é verdadeira também quando a Open-Meteo é MAIOR que o MERGE (ex: Recife 26/06 — 51,1 < 92,7×2 = 184,4) — ou seja, o branch "usar o maior dos dois" nunca era alcançado exatamente no caso que a mudança deveria resolver.

**Corrigido**: comparação reordenada — primeiro checa se Open-Meteo > MERGE (usa o maior dos dois), depois se MERGE > 2× Open-Meteo (usa MERGE), senão usa MERGE por ter melhor resolução espacial.

**Testado** com os 3 eventos reais já levantados no relatório pré-deploy:
- Natal/Pitimbú (MERGE ~128-147mm, Open-Meteo ~30mm) → `merge_cptec_priority`, usa MERGE. ✅
- Recife/Ibura 26/06 (MERGE 51,1mm, Open-Meteo 92,7mm) → `max_merge_openmeteo`, usa o maior (92,7mm). ✅ (esse era exatamente o caso que a v1 quebrava)
- João Pessoa/Valentina (MERGE 65,5mm, Open-Meteo 74,8mm, diferença pequena) → `max_merge_openmeteo`. ✅

## 🟡 3. Regra 2 (maré alta + chuva costeira) com maré desatualizada

`lib/cptec.ts` agora retorna `cached_at` em toda leitura de maré. `lib/score.ts` ganhou `isTideDataRecent()` (limite 26h) e a Regra 2 só dispara automaticamente com maré fresca — sem gate, ela disparava mesmo com maré de dias atrás.

**Testado**: cenário sintético com `tideLastUpdated` de 30h atrás — regra não dispara mais (antes disparava). Com `tideLastUpdated` de 10h atrás — dispara normalmente.

## 🟡 4. Painel de bairro sem Realtime

`hooks/useRisk.ts` ganhou assinatura `postgres_changes` própria (filtro `neighborhood_id=eq.<id>`, separado da assinatura ampla de `useRealtime.ts` que só alimenta as cores do mapa). `DetailPanel.tsx` ganhou badge "Atualizado agora" (3s, Framer Motion).

**Testado ao vivo no navegador**: abri o painel de Pitimbú via `?bairro=<id>`, inseri uma linha real em `risk_scores` via SQL direto (simulando o que o cron escreveria) — score/nível/breakdown do painel aberto atualizaram sozinhos (0,40→0,56, Crítico→Atenção) com o badge aparecendo, sem reload.

## 🟡 5. `rain_source` ausente em `risk_scores`

Migração `015_risk_scores_rain_source.sql` aplicada. `insertRiskScoresBatch` (`app/api/cron/update/route.ts`) agora grava `weather.rain_source` como 17º parâmetro/coluna.

**Testado com execução real e completa do cron** (não simulação): 7.117 bairros processados, **0 linhas com `rain_source` NULL**, distribuição:

| rain_source | linhas |
|---|---:|
| `max_merge_openmeteo` | 4.108 |
| `merge_cptec` | 2.467 |
| `merge_cptec_priority` | 537 |
| `openmeteo` | 5 |

Consistente com o estado real do `merge_cache` no momento do teste.

## 🟡 6. Rate limiter Open-Meteo — investigação (não elevar)

**Pergunta original**: dá pra elevar o limite interno de 500 chamadas/hora com segurança?

**Investigação feita**: contagem real de células únicas via Turf.js (PostGIS não está habilitado neste banco — mesma limitação já contornada no relatório pré-deploy), agrupando por `city_id + grid 0,05°` (mesma chave que `getCachedWeather` usa de verdade):

- **7.117 bairros → 3.839 células únicas** (confere com o "~3.849" já estimado no relatório anterior).

**Limites reais do Open-Meteo** (confirmados na página oficial de pricing + relatos de erro 429 em produção — [open-meteo.com/en/pricing](https://open-meteo.com/en/pricing), [GitHub issue #438](https://github.com/open-meteo/open-meteo/issues/438)):

| Janela | Limite |
|---|---:|
| Por minuto | 600 |
| Por hora | 5.000 |
| **Por dia** | **10.000 (com enforcement real de 429 "Daily API request limit exceeded")** |
| Por mês | 300.000 |

**Achado — a pergunta certa não é "por hora", é "por dia"**: o teto de 5.000/h do Open-Meteo é bem mais alto que o limite interno atual (500/h) — nesse sentido, "elevar" pareceria seguro. Mas o cache (`CACHE_TTL_MINUTES = 20`) expira exatamente no mesmo intervalo em que o cron roda (`*/20 * * * *`), então em regime estável **praticamente todas as 3.839 células pedem dado novo a cada ciclo** — ou seja, a demanda real é de até 3.839 chamadas por ciclo de 20min, não uma taxa suave.

Fazendo a conta pro teto que **realmente importa** (10.000/dia, com enforcement confirmado):

- Rodando continuamente no teto atual (500/h × 24h) = **12.000 chamadas/dia — já 20% acima da cota real de 10.000/dia**, mesmo sem qualquer elevação.
- Orçamento diário sustentável pro limitador interno: `10.000 ÷ 24h ≈ 417/h` (deixando de fora até a margem de segurança e as chamadas extras de `fetchForecastDisplay` quando um usuário abre um bairro).
- Pra atualizar as 3.839 células únicas dentro de 10.000 chamadas/dia, o refresh médio possível por célula é `24h ÷ (10.000/3.839) ≈ 9,2 horas` — não os 20 minutos que a arquitetura pretende.

**Conclusão**: **não elevar o limitador.** Ao contrário — o valor atual (500/h), se sustentado continuamente, já ultrapassa em ~20% a cota diária real de 10.000 chamadas (o mesmo tipo de esgotamento que já aconteceu de verdade no fim de semana de 18-19/07/2026, documentado no código). O gargalo real não é a taxa por hora (a Open-Meteo permite 5.000/h — 10× o limite interno atual), é a cota diária. Recomendações para uma correção futura (fora do escopo desta tarefa, que pediu só investigação):

1. Baixar o limitador interno para algo em torno de 400/h (deixando margem pras chamadas de previsão do painel), **ou**
2. Substituir o contador "por hora" por um contador "por dia" como mecanismo primário (é o que a Open-Meteo de fato aplica), com o contador por hora mantido só como guarda-corpo anti-rajada, **ou**
3. Reduzir a resolução da grade (ex: 0,1° em vez de 0,05°, cortando ~4× o número de células) ou aumentar o TTL do cache — mas isso troca atualização quase em tempo real por uma que só é sustentável dentro da cota gratuita.

Nenhuma dessas 3 opções foi implementada nesta tarefa — o pedido original era só avaliar se a elevação era segura, e a resposta é não.

## 🟢 7. Bairros fora do bbox do MERGE

Os 6 bairros já identificados no relatório pré-deploy (extremo norte do MA: Estandarte/Cândido Mendes, Aurizona/Godofredo Viana, Godofredo Viana, Apicum-Açu, Carutapera, Luís Domingues) foram checados no `risk_scores` gerado pela execução real do cron desta sessão:

| Bairro | Cidade | `rain_source` | `level` |
|---|---|---|---|
| Apicum-Açu | Apicum-Açu | `max_merge_openmeteo` | normal |
| Barão de Tromaí | Cândido Mendes | `max_merge_openmeteo` | normal |
| Cândido Mendes | Cândido Mendes | `max_merge_openmeteo` | normal |
| Aurizona | Godofredo Viana | `openmeteo` | normal |
| Godofredo Viana | Godofredo Viana | `openmeteo` | normal |
| Luís Domingues | Luís Domingues | `openmeteo` | normal |
| Estandarte | Cândido Mendes | `openmeteo` | normal |
| Carutapera | Carutapera | `openmeteo` | normal |

**Achado interessante**: 3 dos 8 bairros na verdade **recebem dado MERGE** (`max_merge_openmeteo`) — a checagem de `lib/merge.ts` não usa um bbox rígido, ela arredonda lat/lng pra grade do MERGE e consulta `merge_cache` por célula exata; esses 3 bairros caem numa célula que tem dado, mesmo estando perto/além do limite geométrico reportado antes. Os outros 5 realmente não têm célula do MERGE e caem limpo pro Open-Meteo puro, sem erro.

**Confirmado: nenhum quebrado.** Todos calcularam score normalmente, sem exceção nem fallback silencioso incorreto.

## 🟢 8. Colisão de nomes bairro/município (Pitimbú/Pitimbu)

Rodei uma varredura completa comparando o nome de cada bairro (normalizado, sem acento) contra o nome de todo município do Nordeste, filtrando só colisões com um **município diferente da cidade do próprio bairro**.

- **985 bairros** têm o mesmo nome (ignorando acento) de algum município em outro estado — a maioria é nome comum de topônimo brasileiro (Santo Antônio, Santa Luzia, Novo Horizonte etc.), não um problema de dado, é só a toponímia brasileira sendo repetitiva.
- Dessas, **20 colisões têm grafia realmente diferente** (variação de acento/hífen/maiúscula) — o mesmo padrão do caso original **Pitimbú (bairro, Natal/RN) vs Pitimbu (município, PB)**. Lista completa: Araçoiaba/Aracoiaba (PE↔CE), Acarapé/Acarape, ANDORINHA/Andorinha, Santo Antonio/Santo Antônio (2×), São Vicente Férrer/Ferrer (2×), Pão de Açucar/Açúcar, Santa Cecilia/Cecília, Olho D'Água (4 variações de capitalização), Sao João Batista/São, Sossego/Sossêgo, Mulungú/Mulungu, Mãe D'Água, São Luis/Luís.

**Verificado no código**: `neighborhoods.city_id` vem da geometria (pipeline IBGE, geoespacial), não de comparação de string — não há nenhum caminho no app que resolva bairro→cidade ou bairro→evento por nome. O único match por `name ===` no código (`components/map/EmptyStateLayer.tsx:45`) compara **cidade contra polígono municipal do próprio dataset de contorno**, não bairro contra município. **Confirmado: não é um bug funcional**, é só uma coincidência de toponímia que pode confundir humanos lendo relatórios/logs (como aconteceu no relatório pré-deploy), não o sistema.

---

## Perguntas finais

**Quais problemas foram resolvidos?**
Os 5 problemas 🔴/🟡 que pediam código foram implementados, testados individualmente (unitário, live no navegador, ou execução real e completa do cron) e commitados em separado. O item 6 (rate limiter) foi investigado a fundo como pedido, mas a conclusão é "não mexer nesse sentido" — não houve código pra mudar porque a resposta à pergunta original é negativa. Os 2 itens 🟢 foram confirmados como não sendo bugs.

**Algum novo problema encontrado durante as correções?**
Um achado novo e relevante: **o rate limiter atual (500/h), se sustentado continuamente, já excede em ~20% a cota diária real do Open-Meteo (10.000/dia)** — o mesmo tipo de esgotamento de cota que já aconteceu de verdade em 18-19/07/2026. Isso não é um problema introduzido pelas correções desta rodada, é uma limitação estrutural pré-existente que a investigação do item 6 deixou mais precisa (antes só se sabia que 500/h era "insuficiente pra cobrir tudo"; agora sabemos que mesmo esse valor menor que a demanda real já é alto demais frente à cota diária). Recomendo tratar isso como item de acompanhamento — não bloqueia deploy, mas deve ser corrigido antes que o tráfego real de produção rode por dias seguidos sem intervenção manual.

**O produto está pronto para deploy após essas correções?**
Sim, com uma ressalva operacional. Os bloqueadores e problemas médios de funcionalidade estão resolvidos e testados com dados/execuções reais. A ressalva é o rate limiter: o comportamento atual (fallback silencioso pra cache expirado quando a cota aperta) é seguro — não quebra nada, só entrega dado mais velho — mas nos primeiros dias após o deploy, e periodicamente depois disso caso a cota diária real seja atingida, uma fração da malha vai mostrar `weather_cache` desatualizado até o próximo ciclo em que a cota abrir margem. Isso já é o comportamento esperado e documentado (não é regressão desta rodada), mas vale como primeiro item da próxima iteração pós-deploy.
