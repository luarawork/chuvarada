# Revisão de qualidade de código

Diagnóstico apenas — nenhuma correção foi aplicada a partir desta revisão. Todos os achados abaixo foram verificados diretamente no código e/ou no banco de produção antes de entrar neste relatório (nada aqui é especulativo).

Contexto: os 4 bugs já conhecidos (select */n.\* quebrando com coluna removida, gráfico colorindo por score em vez de level, Regra 3 com limiar 0, limiares hardcoded) foram usados como ponto de partida — a varredura confirmou que **os dois primeiros têm outras ocorrências não corrigidas**, e que o quarto é mais amplo do que só os limiares numéricos.

---

## 🔴 Crítico — corrigir imediatamente

### 1. Cron B (clima) tem o mesmo bug de `geometry` que já quebrou o Cron A — e está ativo agora

- **Arquivo**: [app/api/cron/weather/route.ts:87](app/api/cron/weather/route.ts:87)
- **Problema**: `select * from neighborhoods where city_id = any($1::uuid[])` — sem o alias `geometry_simplified as geometry`. Esse resultado alimenta `groupNeighborhoodsByCell()` ([linha 102](app/api/cron/weather/route.ts:102)), que chama `turf.centroid(neighborhood.geometry)` pra qualquer cidade com mais de 10 bairros (`LARGE_CITY_THRESHOLD`, `lib/cellGrouping.ts:12`). Coluna `geometry` crua não existe mais desde a migração 032 — exatamente o mesmo bug corrigido em `app/api/cron/scores/route.ts` e `app/api/cron/scores/emergency/route.ts` nesta sessão, mas que passou batido nesta 3ª rota.
- **Impacto real, confirmado agora no banco de produção**: o Cron B roda a cada 30min e é o único que atualiza `weather_cache` (rain_1h, vento, umidade, pressão — tudo que não vem do MERGE). Consultei `weather_cache` de Salvador/Recife/Natal/São Paulo/Rio/Fortaleza/Manaus/Porto Alegre: todas estão com o clima **3 a 5 dias desatualizado** (ex: Porto Alegre e São Paulo em 23/07, hoje é 28/07). No total, **604 cidades com mais de 10 bairros estão sem weather_cache fresco (<3h)**. Como o Cron A (já corrigido) recalcula `risk_scores` a cada hora usando `getWeatherFromCacheOnly` — ele está produzindo scores com `calculated_at` fresco, mas calculados sobre `rain_1h`/vento/umidade/pressão de dias atrás pra praticamente toda cidade grande do país. Isso mascara silenciosamente a correção que acabou de ser aplicada: os scores parecem atualizados, mas o dado de clima por trás não é.
- **Sugestão**: aplicar a mesma correção já feita em `app/api/cron/scores/route.ts` — `select id, city_id, name, name_source, geometry_simplified as geometry, terrain_slope, hydro_proximity, is_coastal, created_at from neighborhoods where city_id = any(...)`, com a normalização `typeof n.geometry === "string" ? JSON.parse(...) : n.geometry`.

### 2. `app/api/cron/update/route.ts` tem o mesmo bug, em 2 lugares

- **Arquivo**: [app/api/cron/update/route.ts:76-77](app/api/cron/update/route.ts:76)
- **Problema**: `select * from cities where active = true` e `select * from neighborhoods` — mesma ausência de alias de geometria. Esta rota está documentada como fallback manual depreciado (Architecture Wiki: "existe ainda no código como fallback manual depreciado, não faz parte do fluxo de produção"), não é chamada pelos workflows do GitHub Actions.
- **Impacto**: como não faz parte do ciclo automatizado, o risco só se materializa se alguém disparar essa rota manualmente (ex: debugging, ou reativação futura do cron único) — mas nesse caso quebraria exatamente pras mesmas ~605 cidades grandes, do mesmo jeito que os outros dois já quebravam.
- **Sugestão**: mesma correção, ou — já que a rota é deprecated e não usada — considerar removê-la de vez em vez de mantê-la como uma 3ª cópia da mesma lógica pra manter sincronizada manualmente.

---

## 🟡 Médio — corrigir antes da próxima feature

### 3. Limiares do modelo (0,30/0,60) duplicados como literais soltos no frontend, sem constante compartilhada

- **Arquivos**: [components/panel/HistoryChart.tsx:101-103](components/panel/HistoryChart.tsx:101), [app/analise/page.tsx:1139-1141](app/analise/page.tsx:1139)
- **Problema**: `lib/constants.ts` existe (usado hoje só para `MERGE_MAX_AGE_HOURS` e `TILE_LAYERS`) mas não tem os limiares do modelo. A única definição real é `levelFromScore()` em `lib/score.ts:35-39` — uma função **não exportada**, que nem poderia ser importada pelo frontend hoje. As duas telas acima desenham `<ReferenceArea y1={0} y2={0.3}>`, `y1={0.3} y2={0.6}` como números soltos, coincidindo hoje com o backend só porque ninguém mudou um lado sem lembrar do outro.
- **Impacto**: os limiares já mudaram uma vez (de 0,4/0,7 para 0,3/0,6, 20/07/2026, por causa do diagnóstico de Recife). Se mudarem de novo, as faixas coloridas de fundo desses 2 gráficos ficam **silenciosamente incorretas** — sem erro, sem warning, só uma faixa visual errada.
- **Sugestão**: criar `SCORE_THRESHOLDS = { normal: 0.3, attention: 0.6 }` em `lib/constants.ts`, fazer `lib/score.ts` importar de lá (em vez dos literais `0.3`/`0.6` inline), exportar `levelFromScore`, e importar a mesma constante nos 2 componentes React.

### 4. Cores de risco (#2a9d72/#f0a500/#d64045) duplicadas em pelo menos 5 arquivos além do canônico

- **Canônico**: `RISK_COLORS` em [lib/geojson.ts:4-8](lib/geojson.ts:4) — hoje só é de fato importado por `NeighborhoodLayer.tsx` (via `NEIGHBORHOOD_STYLES`) e por `HistoryChart.tsx` (corrigido nesta sessão).
- **Duplicatas hardcoded encontradas**:
  - [components/map/MunicipalityLayer.tsx:14-16](components/map/MunicipalityLayer.tsx:14) — `LEVEL_COLOR` local, mesmos 3 hex.
  - [components/ui/AlertCard.tsx:8-10](components/ui/AlertCard.tsx:8) — mesmos 3 hex embutidos no objeto de configuração.
  - [components/ui/MapLegend.tsx:6-8](components/ui/MapLegend.tsx:6) — array local com os mesmos 3 hex.
  - [app/analise/page.tsx:23](app/analise/page.tsx:23) — `const COLORS = {...}` local; o comentário na linha 21 até *reconhece* "Paleta consistente com o resto do app (RISK_COLORS em lib/geojson.ts...)" mas não importa de lá.
  - [app/como-funciona/page.tsx:58-60](app/como-funciona/page.tsx:58) — mesmos 3 hex, contexto educativo (risco menor, mas mesma causa raiz).
- **Impacto**: mudar a paleta de risco (ex: acessibilidade para daltonismo) exigiria editar 6 arquivos manualmente — exatamente o tipo de mudança onde é fácil esquecer 1 e gerar inconsistência visual sutil entre o mapa e o resto do app.
- **Sugestão**: os 5 arquivos acima devem importar `RISK_COLORS` de `lib/geojson.ts` em vez de redefinir os hex.

### 5. `emergency/route.ts` não adquire nenhum lock antes de escrever `risk_scores`

- **Arquivo**: [app/api/cron/scores/emergency/route.ts](app/api/cron/scores/emergency/route.ts) (rota inteira)
- **Problema**: diferente de `scores/route.ts` (`scores_cron_running`), `update/route.ts` e `weather/route.ts` (cada um com seu lock via `lib/systemLock.ts`), esta rota chama `scoreCity()` diretamente sem checar `isLocked`/`acquireLock`. Ela é disparada por `fetch_merge_cptec.py` quando detecta célula com `rain_72h > 100mm` ou `rain_peak_3h > 30mm` — ou seja, justamente durante o tipo de evento em que o Cron A horário também pode estar no meio de um ciclo.
- **Impacto**: se as duas rodarem ao mesmo tempo para os mesmos bairros, `insertRiskScoresBatch`/`syncRiskEventsBatch` podem intercalar gravações — no pior caso, um `risk_events` aberto/fechado de forma inconsistente ou uma leitura de `peak_score` desatualizada entre as duas execuções (race clássica de "ler estado, depois escrever com base nele" sem lock). Janela estreita, mas coincide exatamente com o momento de maior importância (chuva intensa).
- **Sugestão**: usar o mesmo lock `scores_cron_running` (ou um dedicado, tipo `emergency_scores_running`) antes de processar, com uma janela curta o bastante pra não atrasar o recálculo de emergência.

### 6. Lock de `system_locks` não é atômico (race condition no próprio mecanismo de lock)

- **Arquivo**: [lib/systemLock.ts:16-30](lib/systemLock.ts:16)
- **Problema**: `isLocked()` (um `SELECT`) e `acquireLock()` (um `INSERT ... ON CONFLICT DO UPDATE` separado) são duas queries distintas, sem transação nem `SELECT ... FOR UPDATE`. Duas requisições quase simultâneas podem ambas executar `isLocked()` e ver `false` antes que qualquer uma chame `acquireLock()` — as duas prosseguem acreditando ser a única.
- **Impacto**: o cenário mais provável de disparar isso é justamente 2 gatilhos próximos no tempo (ex: cron agendado + disparo manual de teste, ou — combinado com o achado #5 — cron horário + `/emergency` quase simultâneos). Janela de corrida é de milissegundos, mas o próprio propósito do lock é evitar exatamente essa concorrência.
- **Sugestão**: trocar por um único `INSERT INTO system_locks (...) ON CONFLICT (key) DO UPDATE SET ... WHERE system_locks.locked_at < now() - interval '{maxAge} minutes' RETURNING *` — se não retornar linha, o lock já estava ativo; atômico em uma única query.

### 7. `select *` / `n.*` remanescentes em produção (fora dos 2 já corrigidos e dos 2 do item 🔴)

Cada um é uma dependência implícita e não documentada em "a tabela X tem essas colunas, nesta ordem, com estes nomes" — quebra silenciosamente (campo `undefined` em vez de erro) se a tabela mudar, exceto onde já indicado que o risco é menor.

| Arquivo:linha | Tabela | Uso posterior | Risco se coluna sumir |
|---|---|---|---|
| [lib/riskScoring.ts:137](lib/riskScoring.ts:137) | `risk_events` | `.peak_score`, `.id`, `.neighborhood_id` em `syncRiskEventsBatch` | Silencioso — comparação `score > undefined` vira `false`, evento nunca atualiza o pico |
| [lib/weather.ts:708](lib/weather.ts:708) | `weather_cache` | cast direto `as WeatherCache \| null`, todos os campos usados no cálculo de score | Silencioso — TS "mente" que o campo existe, valor vira `undefined`/`NaN` no modelo |
| [app/api/reports/route.ts:188](app/api/reports/route.ts:188), [:160](app/api/reports/route.ts:160) | `user_reports` | cast `as UserReport[]`, servido direto pro frontend/`/analise` | Silencioso no backend; frontend mostraria `undefined` |
| [app/api/neighborhoods/route.ts:46](app/api/neighborhoods/route.ts:46), [app/api/reports/route.ts:81](app/api/reports/route.ts:81) | `risk_scores` (dentro de `LATERAL`) | Colunas específicas extraídas depois por nome (`rs.score`, `rs.level`, etc.) | Menor — um `DROP COLUMN` que uma dessas queries externas referencia geraria erro de SQL, não `undefined` silencioso |
| [app/api/cron/scores/route.ts:43](app/api/cron/scores/route.ts:43), [emergency/route.ts:68](app/api/cron/scores/emergency/route.ts:68), [update/route.ts:76](app/api/cron/update/route.ts:76), [weather/route.ts:47](app/api/cron/weather/route.ts:47) | `cities` | Campos escalares (`lat`, `lng`, `tide_code`, `data_level` etc.) | Baixo — sem coluna do tipo geometria; ainda assim inconsistente com o padrão de coluna explícita usado nas outras rotas |

- **Sugestão geral**: para as 3 primeiras linhas da tabela, migrar para lista explícita de colunas (mesmo padrão já usado em `app/api/neighborhoods/route.ts`'s `SELECT_COLUMNS`). Para `cities`, baixa urgência, mas mesma recomendação por consistência.

---

## 🟢 Baixo — melhoria técnica

### 8. `terrain_slope` ainda com placeholder (0,5) em 9 bairros

- Distribuição: MT (3), AP (2), RR (2), SC (2) — residual de expansões estaduais anteriores, escala pequena.
- **Sugestão**: baixa prioridade, mas vale registrar no Roadmap/Cobertura se ainda não estiver.

### 9. `hydro_proximity = 0` em 64 bairros

- Não investigado a fundo nesta rodada — `0` pode ser um valor real (bairro literalmente às margens d'água) ou resíduo de placeholder, dependendo do bairro. Já foi objeto de investigação específica antes (tarefa "4.1 Verificar/corrigir bbox BHO e hydro_proximity=0" no histórico do projeto).
- **Sugestão**: se ainda não houver, uma query cruzando esses 64 com `is_coastal`/distância real serviria para confirmar se são legítimos.

### 10. Sem `server-only` (ou equivalente) protegendo módulos server-only em build-time

- Nenhuma violação encontrada agora (nenhum Client Component importa `lib/db`, `lib/b2` ou `lib/auth`), mas não há rede de segurança que barre isso no futuro — hoje depende só de disciplina/revisão manual.
- **Sugestão**: adicionar `import "server-only"` no topo de `lib/db.ts`, `lib/b2.ts`, `lib/auth.ts` — falha de build imediata se algum Client Component tentar importar.

---

## ✅ Sem problema encontrado

- **Consistência `level` vs `score`**: `0` linhas em `risk_scores` onde o `level` gravado destoa do que a fórmula produziria (considerando `auto_critical`) — o modelo está internamente consistente.
- **Frescor geral dos scores**: `0` cidades com `risk_scores.calculated_at` mais antigo que 3h no momento da checagem — a correção do Cron A (feita nesta sessão) segue funcionando para todas as 5.570 cidades.
- **Dados geoespaciais**: `0` bairros sem `centroid_lat/lng`, `0` sem `geometry_simplified`.
- **`lib/merge.ts`**: verifica corretamente o lock `merge_cache_write` (via `isMergeCacheWriting()`) antes de ler `merge_cache` — não é afetado pelo problema do item 🟡 #6 (é leitura, não aquisição de lock).
- **Validação de input nos endpoints de escrita**: `POST /api/reports`, `POST /api/reports/[id]/react`, `POST /api/suggestions`, `PATCH`/`DELETE /api/suggestions/[id]` — todos validam tipo, valores permitidos (whitelist), tamanho de payload (`rejectIfPayloadTooLarge`) e, onde aplicável, senha de admin. `reports/[id]/react` ainda usa a constraint `UNIQUE` do banco (código `23505`) para evitar race condition de dupla reação, em vez de um `SELECT` prévio — padrão correto.
- **Separação client/server**: nenhum Client Component (`"use client"`) importa `lib/db`, `lib/b2` ou `lib/auth`.
- **Duplicação Python/TypeScript**: confirmado que **não existe** nenhuma lógica de `rain_1h`/regras de auto-crítico em Python — `scripts/python/fetch_merge_cptec.py` só grava `rain_72h`/`rain_peak_3h` em `merge_cache`. `lib/score.ts` é a única fonte de verdade das regras automáticas.
- **`app/api/analise/verify-password/route.ts` sem try/catch**: falso positivo do grep mecânico — a rota não faz nenhuma chamada de I/O que possa lançar exceção (só leitura de header + função pura `verifyAdminPassword`), então não há necessidade real de try/catch ali.

---

## Resumo por prioridade

| Severidade | Itens |
|---|---|
| 🔴 Crítico | 2 (Cron B com weather_cache stale há dias em 604 cidades; Cron A legado com o mesmo bug) |
| 🟡 Médio | 5 (limiares duplicados, cores duplicadas, emergency sem lock, lock não-atômico, `select *` remanescentes) |
| 🟢 Baixo | 3 (placeholders residuais, sem `server-only`) |
| ✅ Verificado OK | 7 categorias |

Nenhuma correção foi aplicada. Aguardando aprovação para corrigir — sugiro começar pelo item 🔴 #1 (Cron B), já que é o que está ativamente produzindo dado incorreto em produção neste momento.
