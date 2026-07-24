# Diagnóstico pós-expansão nacional (Centro-Oeste + Norte, 22-23/07/2026)

## Qualidade dos dados dos 11 estados novos

Resultado do `scripts/diagnostico_expansao_nacional.js` rodado após o upload:

| Estado | Municípios | Bairros/distritos | `terrain_slope`=0.5 (placeholder) | `hydro_proximity`=0 | `name_source` nulo |
|---|---|---|---|---|---|
| GO | 246 | 421 | 0 | 0 | 0 |
| MT | 141 | 897 | 3 | 5 | 0 |
| MS | 79 | 462 | 0 | 1 | 0 |
| DF | 1 | 33 | 0 | 0 | 0 |
| AM | 62 | 572 | 0 | 6 | 0 |
| PA | 144 | 616 | 0 | 13 | 0 |
| RR | 15 | 70 | 2 | 3 | 0 |
| AP | 16 | 126 | 2 | 3 | 0 |
| AC | 22 | 109 | 0 | 0 | 0 |
| RO | 52 | 464 | 0 | 8 | 0 |
| TO | 139 | 157 | 0 | 0 | 0 |

Placeholders de `terrain_slope` (0-3 por estado) e `hydro_proximity`=0 (0-13 por
estado) dentro do padrão esperado de casos-limite vistos em expansões
anteriores — sem repetição do bug de corrupção de raster visto no
processamento do GO (corrigido antes do upload). `name_source` nulo: zero em
todos os 11 estados, backfill/fix de sessões anteriores continua valendo.

**Total nacional pós-expansão:** 5.570 municípios (917 novos), 28.483
bairros/distritos (3.927 novos), 5.567/5.570 municípios com polígono na
tabela `municipalities` (3 exceções de encoding em estados já cobertos antes
desta expansão, fora de escopo).

## Medição do tempo do cron nacional: não concluída — achado de rate-limit

Duas tentativas de rodar `/api/cron/update` manualmente com o volume nacional
completo (5.570 cidades ativas, 28.483 bairros):

- **Tentativa 1** (22/07): processo interrompido no meio (trava órfã,
  ~40.788 scores parciais gravados, todos de estados antigos — os 11 novos
  não chegaram a ser processados). Memória do sistema já estava apertada
  (~1,6-1,9GB livres de 8GB) por outros programas, não pelo pipeline em si.
- **Tentativa 2** (23/07): com mais memória livre (~2,5-3,5GB no início), o
  processo não crashou, mas ficou **extremamente lento** — só ~894 scores em
  ~40 minutos (contra o esperado de dezenas de milhares no mesmo intervalo em
  ciclos anteriores). Causa identificada nos logs do servidor: **Open-Meteo
  devolvendo HTTP 429 (rate limit) pra praticamente toda célula de clima**,
  forçando fallback pro WeatherAPI.com em cascata.

**Causa raiz provável:** o `weather_cache` tinha expirado (TTL de 24h) desde
o último ciclo bem-sucedido (>31h antes desta tentativa), forçando o cron a
buscar clima do zero pro país inteiro de uma vez — não só as células novas
do Centro-Oeste/Norte, mas também as dos 16 estados já cobertos, cujo cache
também tinha vencido. Esse pico de demanda simultânea excede o limite de
taxa do plano gratuito do Open-Meteo, que antes da expansão nacional nunca
tinha sido atingido dessa forma.

**Risco identificado para produção:** se o cron agendado (Vercel Cron ou
equivalente) rodar de hora em hora como configurado, cada célula só precisa
de refresh quando o cache dela specificamente expira — o comportamento
observado aqui (pico simultâneo em todo o país) só acontece quando o
`weather_cache` inteiro já está frio (ex: depois de um período longo sem
rodar o cron, como nesta sessão de testes). Em operação normal e contínua, a
demanda deveria ficar distribuída ao longo do tempo em vez de concentrada.
Ainda assim, o volume de células distintas cresceu substancialmente com a
expansão nacional, e vale monitorar `cron_run_stats` (`weatherapi_fallback_count`,
`neutral_fallback_count`) nos primeiros dias de operação real pra confirmar
que o rate-limit do Open-Meteo não vira um problema recorrente com o volume
novo. Não foi corrigido nesta sessão — decisão do usuário foi documentar o
achado e não medir o tempo exato do ciclo completo.
