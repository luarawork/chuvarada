# Investigação: falha do `fetch_merge_cptec.py` e evento de Natal

Diagnóstico apenas — nenhuma mudança de código ou configuração foi feita a partir desta investigação. Duas descobertas centrais: a falha do `fetch_merge_cptec.py` é recorrente (não isolada) e tem uma causa provável concreta no código; e o "evento de Natal" não é (só) uma questão de calibração de decaimento — é sintoma de um problema mais sério e sistêmico: as 3 cidades `data_level='full'` (Salvador, Recife, Natal) pararam de receber score novo há mais de 2 dias, enquanto o resto do país continua atualizando normalmente.

---

## 1. Falha do `fetch_merge_cptec.py` (run 30287259457)

### 1.1 Log completo do run

**Não foi possível obter** — a API de logs do GitHub Actions (`GET /actions/runs/{id}/logs` e `/actions/jobs/{id}/logs`) exige um token autenticado mesmo em repositório público (`403 Forbidden` confirmado); não há `GITHUB_TOKEN`/`GH_TOKEN` configurado neste ambiente, e `gh` CLI não está disponível. A API pública (sem token) só devolve metadados de run/job/step — não o texto do log em si. Isso bloqueou a leitura do traceback exato tanto agora quanto na investigação anterior desse mesmo run.

O que foi possível obter via API pública (`/actions/runs/{id}/jobs`):

| Step | Conclusão | Duração |
|---|---|---|
| `actions/checkout@v4` | success | 84s |
| `actions/setup-python@v5` | success | 0s |
| `pip install rasterio numpy requests pg8000` | success | 7s |
| `python scripts/python/fetch_merge_cptec.py` | **failure** | **152s** |
| `update_scores` (job seguinte) | skipped (`needs: update_merge`) | — |

### 1.2 Padrão de falhas

Analisados **44 runs** do workflow desde sua criação (não há histórico de 2 semanas — o workflow é mais novo que isso). Resultado: **17 falhas, 27 sucessos**. Mas o padrão não é uniforme ao longo do tempo — há duas eras bem distintas:

- **22/07 a 24/07** (13 runs): quase todas falharam — era anterior, provavelmente relacionada a problemas de configuração/infraestrutura já resolvidos (não investigado a fundo aqui, fora do escopo desta run específica).
- **A partir de 25/07 03:22**: o sistema estabiliza — mas **não fica livre de falhas**. Nessa era "estável" (dos 25/07 até agora), houve **4 falhas isoladas** do `update_merge`, todas com a mesma assinatura (step `fetch_merge_cptec.py` falha, `update_scores` pulado):

| Run | Início (UTC) | Duração até falhar |
|---|---|---|
| 30174545333 | 25/07 20:55 | 305s |
| 30176665044 | 25/07 21:58 (63min depois) | 67s |
| 30215695271 | 26/07 18:53 | 84s |
| 30287259457 | 27/07 16:59 (a run pedida) | 152s |

**Conclusão: não é uma falha isolada — é recorrente**, acontecendo aproximadamente 1 vez por dia desde que o sistema estabilizou (~4 falhas em ~68h de operação, cerca de 1 em cada 15-17 execuções horárias). Depois de cada falha, a run seguinte quase sempre se recupera sozinha (só uma vez, em 25/07, houve 2 falhas consecutivas antes de voltar a funcionar).

### 1.3 Estado do `merge_cache` na falha

```sql
SELECT DATE_TRUNC('hour', fetched_at) as hora, COUNT(*) as celulas_gravadas
FROM merge_cache
WHERE fetched_at BETWEEN '2026-07-27 16:00:00+00' AND '2026-07-27 18:00:00+00'
GROUP BY hora ORDER BY hora
```

**Nota**: a data do run é **27/07**, não 26/07 como o pedido original sugeria — ajustada a query pra bater com o `created_at` real do run investigado.

Resultado: **74.166 células gravadas** de ~167.025 esperadas (~44%). Confirma a Hipótese "o script falhou no meio da gravação", não antes de começar nem depois de terminar.

### 1.4 Qual hipótese é mais provável

Sem o log exato, a conclusão é por eliminação de evidências:

- **Hipótese A (timeout de rede) — parcialmente correta, mas não do jeito descrito.** O código **já tem** `timeout=30` configurado em `requests.get()` (`scripts/python/fetch_merge_cptec.py:84`) — não é "sem timeout". Só que um timeout de rede em `fetch_grib2()` é tratado (`except requests.RequestException`, devolve `None`, o arquivo é tratado como indisponível) — isso **não derruba o script**. O que **não é tratado**: se a conexão devolver HTTP 200 mas o corpo vier truncado/corrompido (conexão caiu no meio da transferência dos ~139MB, sem erro de timeout formal), `fetch_grib2()` aceita esse conteúdo como válido (só checa `status_code != 200 or not res.content`, não valida tamanho/integridade). O byte corrompido só quebra depois, ao abrir com `rasterio.MemoryFile(...)` (`sample_grid()`, linha 131) — **sem nenhum `try/except` ao redor**. Uma exceção do rasterio/GDAL aí propaga até o topo e derruba o script inteiro, sem gravar nada do que sobrou.
  - **Isso já tinha acontecido antes**: a Wiki (`APIs.md`) documenta um incidente idêntico — "um quadrante do Maranhão baixou truncado uma vez (HTTP 200 mas arquivo cortado)" — e afirma que foi **"corrigido com validação completa do raster antes de mesclar"**. **Essa correção não existe no código atual** (confirmado por leitura direta — nenhuma validação de raster, nenhum try/except ao redor do `MemoryFile`). Ou a correção nunca foi de fato aplicada, ou foi perdida em algum momento. Isso é uma inconsistência real entre documentação e código.
  - As durações muito variáveis das 4 falhas (67s a 305s) são consistentes com essa teoria — o ponto de corrupção depende de QUAL arquivo (DAILY ou HOURLY_NOW, qual dia) sofreu o problema de rede naquele momento específico, não é um ponto fixo determinístico no processamento.
- **Hipótese B (GRIB2 corrompido)** — é essencially a mesma causa acima, só sem passar por uma falha de rede identificável (o arquivo do CPTEC em si pode vir malformado do lado do servidor).
- **Hipótese C (erro no Supabase)** — sem evidência a favor: o INSERT em lote já processou ~74 mil células com sucesso antes de parar (44% do total), o que é inconsistente com um erro de conexão/payload que apareceria de forma determinística no mesmo lote toda vez.
- **Hipótese D (memória insuficiente)** — sem evidência a favor nem contra; não há métrica de uso de memória do runner acessível via API pública. Menos provável que A/B dado que os runners `ubuntu-latest` têm 7GB e o processamento é por arquivo (não acumula os ~139MB de múltiplos arquivos simultaneamente em memória — cada `sample_grid()` processa um arquivo por vez).

**Conclusão mais provável: Hipótese A/B combinadas — download truncado/corrompido do GRIB2 (rede ou servidor) sem validação de integridade antes de abrir com rasterio.**

### 1.5 Mecanismo de retry

**Não existe nenhum retry**, nem no script (`fetch_merge_cptec.py` não tem loop de tentativas pra uma falha fatal) nem no workflow (`merge-and-scores-update.yml` não usa `continue-on-error`, nem uma action de retry, nem múltiplas tentativas). Uma falha de rede transitória durante a leitura do raster derruba o ciclo inteiro daquela hora — `update_scores` é corretamente pulado (`needs: update_merge`), então o impacto fica limitado a "essa hora não atualiza", não "score errado é calculado" — mas o ciclo inteiro (~167 mil células, todos os bairros do Brasil) fica sem atualização até a próxima execução agendada, cujo intervalo real já é irregular (ver Architecture Wiki sobre jitter do GitHub Actions, runs de 25/07-27/07 mostram gaps de 1h30-4h entre sucessos).

### Impacto

Nenhum bairro recebeu score **errado** por causa dessas falhas — o `needs` evita exatamente isso. O impacto é só de **atraso**: no run investigado, o ciclo de scores daquela hora não rodou; o próximo run bem-sucedido (18:42 UTC, ~1h43 depois) recalculou todos os ~28.483 bairros normalmente com dado atualizado.

---

## 2. Evento de Natal — modelo em atenção/crítico sem alagamento visível

### 2.1-2.3 Dados encontrados

Rodadas as queries pedidas (com uma correção: a consulta de `weather_cache` das últimas 72h voltou **vazia** — não há nenhuma leitura de `weather_cache` pra Natal nesse intervalo; a leitura mais recente de fato, sem filtro de janela, é de **23/07**, 5 dias atrás).

**A descoberta mais importante não estava no roteiro original**: o score mais recente de Natal em `risk_scores` é de **`2026-07-25T19:15:03`** — mais de **2 dias atrás** do momento desta investigação (`now() = 2026-07-28T00:34`). Ou seja: o "evento" observado (~13h43 UTC, mapa em vermelho/amarelo) não foi calculado com dado de hoje — foi um score **fóssil**, gerado há mais de 53 horas, que nunca foi atualizado desde então.

**E não é só Natal.** Cruzando com Salvador e Recife (as outras 2 cidades `data_level='full'`):

| Cidade | Último score calculado |
|---|---|
| Natal | 2026-07-25T19:15:03.489Z |
| Salvador | 2026-07-25T19:15:03.499Z |
| Recife | 2026-07-25T19:15:03.461Z |

**As 3 cidades `full` pararam de receber score novo no exato mesmo milissegundo, na mesma execução do cron, e nunca mais desde então** — enquanto o resto do país continua normal: 10.012 bairros (de outras cidades) recebem score novo a cada ciclo, incluindo outras cidades do próprio Rio Grande do Norte (Touros, Tibau, Maxaranguape etc. têm score de ~26 minutos atrás no momento desta consulta).

Isso não é um problema de calibração do modelo — é uma **falha sistêmica que congelou exatamente as 3 cidades com o dado mais refinado do projeto**, silenciosamente, há mais de 2 dias.

### O que foi descartado como causa

- **Dado anômalo em `neighborhoods`**: não há `terrain_slope`/`hydro_proximity`/`centroid_lat`/`lng` nulos ou fora de faixa nos 36 bairros de Natal.
- **`cities.active`**: `true` pras 3 cidades.
- **Mudança de código na janela em que o congelamento começou** (25/07 18h-06h do dia seguinte): os únicos commits desse intervalo são 3 fixes de UI (`SearchBar`, `DetailPanel`) — nada tocou `lib/riskScoring.ts`, `lib/score.ts`, `lib/cellGrouping.ts`, `lib/cptec.ts` ou as rotas de cron.
- **Crash ao processar maré**: `tideLevelFromCache()` (`lib/cptec.ts`) já trata `cache.days.length === 0` explicitamente (devolve fallback neutro, não lança exceção) — confirmado por leitura direta do código. `tide_cache` de Natal tem `days: []` (tábua vazia, CPTEC fora do ar, como esperado), mas isso não deveria derrubar o cálculo.

### O que não foi possível confirmar

A causa raiz exata **não foi identificada com certeza** — provavelmente uma exceção não tratada específica dessas 3 cidades dentro de `scoreCity()` (capturada pelo `try/catch` por cidade em `runWithConcurrency`, que só incrementa um contador `citiesWithErrors` devolvido na resposta HTTP da própria chamada — **nunca persistido em lugar nenhum consultável**, nem em `cron_run_stats` — que é alimentado pelo Cron B/clima, não pelo Cron A/scores). Sem acesso a log de execução do servidor (Vercel) nem ao `GITHUB_TOKEN` pra inspecionar Actions, não há como capturar a exceção exata no momento desta investigação.

### Sobre o `auto_critical` e a "garoa"

O último score real (25/07) mostra: `rain_72h` entre 108-133mm em todos os bairros, e `rain_1h` de **0,05 a 0,07mm** — essencialmente chuva residual/ruído de medição, não "chuva nova" no sentido prático. Ainda assim, a Regra 3 (`rain_72h > 100mm E rain_1h > 0`) disparou `auto_critical` pra boa parte dos bairros com essa gravidade — **confirma o Cenário C do pedido**: a regra não tem um limiar de materialidade pro `rain_1h`, então qualquer valor positivo, por menor que seja, combinado com solo saturado, força nível crítico. Isso é uma característica real do modelo hoje, mas ficou mascarada pelo fato de que esse score específico é de 2 dias atrás — o dado atual do `merge_cache` pra grade de Natal já mostra `rain_72h` bem mais baixo (19-44mm nos últimos 2 dias, contra os 108-133mm do score congelado), sugerindo que a chuva real já baixou consideravelmente e o congelamento está mascarando essa melhora.

### Qual cenário se confirma

**Cenário A E C combinados**, mas o fator dominante é outro, não coberto pelo roteiro original: **o score que o usuário viu não reflete o clima de hoje — reflete um cálculo de 2 dias atrás que nunca foi atualizado**, e que POR SI SÓ já tinha o problema do Cenário C (regra de solo saturado disparando com chuva residual de 0,05mm). O modelo não está "tecnicamente correto mas enganoso" — está **desatualizado e, additionally, calibrado de um jeito que superestima levemente nesse tipo de situação**.

### Proposta de melhoria (documentar, não implementar)

1. **Prioridade alta, não é calibração**: investigar e corrigir por que as 3 cidades `data_level='full'` param de receber score. Isso não precisa de hidrólogo — é um bug de sistema, provavelmente uma exceção silenciosa. Recomendação concreta: persistir `cities_with_errors` (e idealmente o nome de cada cidade que falhou) em uma tabela consultável a cada execução do Cron A, não só devolver na resposta HTTP da própria chamada — sem isso, esse tipo de falha silenciosa só é descoberto por acidente (como agora).
2. **Prioridade média, é calibração de verdade**: a proposta de decaimento do `rain_72h` (reduzir gradualmente na ausência de chuva nova significativa) descrita no pedido original é uma melhoria real e coerente com o que os dados mostram aqui — mas depende de validação com especialista em hidrologia (tempo de drenagem varia por solo/declividade/infraestrutura), não deve ser implementada sem isso.
3. **Prioridade média**: dar um limiar mínimo de materialidade pro `rain_1h` na Regra 3 (ex: `rain_1h > 1mm`, não `> 0`) — evita a regra disparar por chuva residual/ruído de medição. Também depende de validação, mas é uma mudança mais simples e isolada que o decaimento.

---

## 3. Resumo

| | |
|---|---|
| **Falha do `fetch_merge_cptec.py`** | Recorrente (~1x/dia desde 25/07), não isolada. Causa mais provável: download truncado/corrompido do GRIB2 sem validação de integridade antes do `rasterio.MemoryFile()` — a correção que a Wiki afirma existir pra esse exato problema (incidente do Maranhão) não está presente no código atual. Sem retry em nenhum nível. Impacto: atraso de um ciclo (~1-2h), nunca score incorreto, graças à proteção via `needs`. |
| **Evento de Natal** | Não é (só) falta de decaimento de risco — é sintoma de uma falha sistêmica maior e mais séria: Salvador, Recife e Natal (as 3 cidades `full`) pararam de receber score novo há mais de 2 dias, congeladas no mesmo milissegundo, enquanto o resto do país segue normal. Causa raiz exata não confirmada por falta de acesso a log de execução. Adicionalmente, o score congelado já demonstrava o problema real do Cenário C: `rain_1h` de 0,05mm (ruído) disparando `auto_critical` por "solo saturado" sem limiar mínimo de materialidade. |
| **Bloqueio comum às duas investigações** | Falta de `GITHUB_TOKEN`/`gh` CLI no ambiente impediu ler o log bruto de qualquer run do GitHub Actions — só metadados (status/duração por step) ficaram disponíveis via API pública. |

---

## 4. Resolução

Escopo real era muito maior do que o relatado acima: não eram só as 3 cidades `full`. Rodando `GET /api/cron/scores` manualmente contra o banco de produção (sem o corte de tempo de execução do Vercel), o próprio endpoint reportou **605 cidades com erro, 18.471 bairros afetados** — Salvador/Recife/Natal só chamaram atenção primeiro por serem as 3 `data_level='full'`, mas a lista incluía qualquer cidade com mais de 10 bairros cadastrados (`LARGE_CITY_THRESHOLD` em `lib/cellGrouping.ts`), de Belém a Porto Velho a São Paulo.

**Causa raiz confirmada**: a migração `scripts/sql/032_remove_raw_geometry.sql` (que dropou a coluna `geometry` crua de `neighborhoods`, mantendo só `geometry_simplified`) documenta explicitamente ter corrigido os 2 lugares que ela sabia que liam `geometry` — `app/api/neighborhoods/route.ts` e `app/api/score/route.ts` — mas **não cobriu 2 outros**: `app/api/cron/scores/route.ts` (`select * from neighborhoods`) e `app/api/cron/scores/emergency/route.ts` (`select distinct n.*`). Com a coluna removida, `neighborhood.geometry` virava `undefined` nesses 2 lugares. `groupNeighborhoodsByCell()` só usa `geometry` (via `turf.centroid()`) quando a cidade tem mais de 10 bairros (`LARGE_CITY_THRESHOLD`) — cidades pequenas usam direto `city.lat/lng` e nunca tocam nesse código, o que mascarou o bug completamente para ~4.965 municípios pequenos e o fez parecer "não sistêmico". Cidades grandes quebravam com `TypeError: Cannot read properties of undefined (reading 'type')` dentro de `turf/meta`'s `coordEach`, capturado pelo try/catch por cidade (silencioso, nunca persistido). A data em que o congelamento começou (`2026-07-25T19:15:03`) bate exatamente com a data que a própria migração 032 registra como quando foi confirmada/aplicada.

**Correção aplicada**: `app/api/cron/scores/route.ts` e `app/api/cron/scores/emergency/route.ts` agora selecionam `geometry_simplified as geometry` explicitamente (mesma convenção dos outros 2 endpoints), com a mesma normalização `JSON.parse` de string quando necessário. Testado ao vivo contra produção: antes da correção, `cities_with_errors: 605`; depois, `cities_with_errors: 0` em todas as 5.570 cidades, com Natal/Recife/Salvador confirmadas com score fresco (e contagem real de bairros — 36/94/170 — batendo com a suposição original, resolvendo também a divergência de contagem vista durante a investigação, que era um artefato de JOIN sem `DISTINCT`).

As outras 2 melhorias documentadas na seção 2.4 (proposta de melhoria) também foram implementadas nesta mesma rodada:
- **Item 1** (bug de sistema): resolvido acima.
- **Item 3** (limiar mínimo de materialidade na Regra 3): `lib/score.ts` mudado de `rain_1h > 0` para `rain_1h > 1` — confirmado que não existe equivalente em Python (`fetch_merge_cptec.py` só grava `rain_72h`/`rain_peak_3h`, nunca `rain_1h` nem lógica de auto-crítico).
- **Item 2** (decaimento de `rain_72h`): permanece não implementado, como recomendado — depende de validação com hidrólogo.

Adicionalmente, `scripts/python/fetch_merge_cptec.py` ganhou validação de integridade (tamanho mínimo do corpo baixado, calibrado contra arquivos reais do CPTEC: ~100KB DAILY, ~20KB HOURLY_NOW) e retry com backoff exponencial (30s/60s/120s) em falha de rede ou integridade — a lacuna que a Wiki (`APIs.md`) já afirmava (incorretamente) estar corrigida.
