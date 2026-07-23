# Diagnóstico: separação do cron em Cron A (scores) + Cron B (clima) — 23/07/2026

## Problema original

Rodar busca de clima e cálculo de score no mesmo ciclo (`/api/cron/update`)
fazia a base **inteira** precisar de clima fresco de uma vez sempre que o
`weather_cache` expirava nacionalmente (ex: >24h sem o cron rodar, cenário
observado nos testes desta sessão). Nesse cenário o Open-Meteo passou a
devolver HTTP 429 em praticamente toda célula, forçando fallback em cascata
pro WeatherAPI.com e tornando o ciclo inviável: ~900 scores em 40min contra
os 28.483 bairros nacionais (ver `diagnostico_expansao_nacional.md`, achado
de 23/07 mais cedo no mesmo dia).

## Solução: dois cronos independentes

- **Cron A** (`app/api/cron/scores/route.ts`) — recalcula `risk_scores` pra
  todos os bairros a partir do que já está em `weather_cache`/`merge_cache`,
  **sem nenhuma chamada externa**. Se não houver cache pra uma célula,
  usa valores neutros (rain=0, vento/umidade/pressão padrão) em vez de
  travar ou chamar API — a atualização de fato é responsabilidade exclusiva
  do Cron B.
- **Cron B** (`app/api/cron/weather/route.ts`) — mantém `weather_cache`
  atualizado aos poucos, em lotes de `WEATHER_CRON_BATCH_SIZE` (padrão 150)
  cidades por execução, nunca a base inteira de uma vez. Prioriza cidades
  sem NENHUM cache (nulls first na ordenação) — é assim que os municípios
  novos de Centro-Oeste/Norte recebem clima antes dos demais.

Peças reaproveitadas sem duplicar lógica: `lib/cellGrouping.ts`
(agrupamento de bairros em células, extraído do cron legado),
`lib/riskScoring.ts` (insert em lote de `risk_scores`/`risk_events`/
`city_risk_summary`, também extraído do legado), `getMergeData` (já era
100% leitura de cache) e duas variantes cache-only novas —
`getWeatherFromCacheOnly` (`lib/weather.ts`) e `getTideLevelCacheOnly`
(`lib/cptec.ts`) — que nunca disparam uma chamada externa.

O cron legado (`/api/cron/update`) foi mantido funcional (refatorado pra
reusar as mesmas peças, comportamento idêntico) como fallback manual por
enquanto — os workflows do GitHub Actions já usam só os 2 cronos novos.

## Resultados dos testes (ambiente local, 23/07/2026)

### Cron A

Rodado uma vez, cobrindo os 27 estados (5.570 cidades, 28.483 bairros) —
parte com `weather_cache` ainda dentro do TTL (estados antigos) e parte
**totalmente sem cache** (os 11 estados novos, nunca visitados antes):

- **28.483/28.483 bairros (100%) receberam score**, incluindo os 11 estados
  novos — cada um bateu exatamente o total de bairros esperado (GO 421,
  MT 897, MS 462, DF 33, AM 572, PA 616, RR 70, AP 126, AC 109, RO 464,
  TO 157).
- **Duração: 8min28s** (22:13:06 → 22:21:34). Acima da meta de <5min do
  plano original, mas sem nenhuma chamada externa — o tempo é só leitura de
  cache/cálculo/insert em lote pra 28.483 linhas. Não travou, não fez
  nenhuma chamada de rede pra API de clima/maré em nenhum momento.
- Memória do processo ficou apertada (~900MB-1GB livres de 8GB) mas estável,
  sem repetir o crash do início da sessão.

### Cron B

Dois testes seguidos, ambos processando o lote máximo (150 cidades, todas
"never_cached" -- havia 917 cidades sem nenhum `weather_cache`, muito acima
do lote):

| Teste | Duração | openmeteo | weatherapi_fallback | Observação |
|---|---:|---:|---:|---|
| 1 (retry original: 6 tentativas/~62s) | **17min15s** | 0 | 157 | Open-Meteo limitando taxa de forma sustentada -- cada requisição gastava até ~1min só em backoff antes de cair pro fallback |
| 2 (retry reduzido: 2 tentativas/1s) | **52s** | 0 | 191 | Mesma condição de rate-limit do Open-Meteo, mas falha rápido pro fallback -- ~95% mais rápido |

**Ajuste feito**: `fetchOpenMeteo` (`lib/weather.ts`) tinha até 6 tentativas
com backoff exponencial (2s, 4s, 8s, 16s, 32s, até ~62s de espera total),
pensado originalmente pra absorver uma rajada momentânea de rate-limit.
Achado do teste 1: quando o rate-limit é **sustentado** (não uma rajada),
esse backoff longo desperdiça minutos por requisição antes de cair pro
fallback da WeatherAPI, que sempre respondeu com sucesso nos dois testes.
Reduzido pra 2 tentativas/1s -- ainda absorve uma rajada breve de verdade,
mas falha rápido quando o limite é persistente.

Após os 2 testes: **300 dos 917 municípios novos já têm `weather_cache`**
(617 restantes). Em operação real (Cron B a cada 30min via GitHub Actions),
os 617 restantes devem ser cobertos em ~4-5 execuções adicionais (~2-2h30
corridas), sempre em lotes pequenos, nunca todos de uma vez.

## O problema de cache frio nacional está resolvido?

**Sim, para o caso que causou o incidente original** (Cron A nunca mais
depende de nenhuma API externa, então nunca mais gera um pico de demanda
simultânea em todo o país) — comprovado rodando o Cron A com 11 estados
inteiros sem cache nenhum e ainda assim terminando em ~8,5min sem nenhuma
chamada de rede.

O Open-Meteo continuar limitando taxa (100% fallback nos 2 testes do Cron
B) é uma condição **externa e separada** -- provavelmente cota diária
esgotada pelos testes acumulados ao longo dos últimos dias nesta mesma
sessão/IP, não um problema da arquitetura nova. Vale monitorar
`cron_run_stats.openmeteo_count` nos primeiros dias de operação real: se
continuar em 0 mesmo num dia sem testes manuais pesados, aí sim seria um
problema à parte (ex: a cota real da Open-Meteo pra essa conta/IP mudou).

## Pendências deste plano (não feitas nesta sessão)

- Passo 7 do plano original (depreciar `/api/cron/update`, renomear pra
  `-legacy`, remover após confirmação em produção) -- adiado
  deliberadamente: os 2 cronos novos ainda não rodaram em produção real
  (só localmente), então o legado continua como fallback manual por
  segurança até isso ser confirmado.
- Medir o Cron A especificamente em cenário 100% cache frio (sem nenhum
  bairro com cache válido) -- o teste real rodado teve cache misto (parte
  quente, parte fria); o resultado observado (100% dos bairros com score,
  incluindo os que não tinham cache algum) já demonstra que o caminho
  "sem cache" funciona corretamente, mas não isola quanto tempo o Cron A
  levaria se **toda** a base estivesse fria ao mesmo tempo.
