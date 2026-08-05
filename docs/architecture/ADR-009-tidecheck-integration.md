# ADR-009: Integração TideCheck para dados de maré

**Status:** Aceito e implementado — rollout em andamento (32 de 115 cidades costeiras com estação atribuída; ver Limitações)

## Contexto

O CPTEC/INPE está degradado desde 2018 (confirmado nesta investigação, não
é mudança de layout — a tábua vem vazia pra qualquer estação/mês/ano
testado, e o webservice alternativo da Marinha foi descontinuado) --
`tide_level` ficava fixo em 0,5 (neutro) pras 115 cidades costeiras com
`tide_code` cadastrado. O modelo tem peso de 8% pra maré e a Regra 2
(crítico automático por maré alta + chuva costeira) nunca disparava.

## Decisão

Integrar a TideCheck API (tidecheck.com) como fonte de dados de maré,
substituindo o fallback neutro pras cidades com estação atribuída.

## Por que TideCheck e não WorldTides

- TideCheck: 50 requisições/dia no plano gratuito, sem cartão, cobre o Brasil
- WorldTides: ~US$4,99/mês (20.000 créditos) — descartado por custo; a
  estrutura (`lib/worldtides.ts`) foi mantida como camada de fallback
  adicional, só ativada se `WORLDTIDES_API_KEY` for configurada

## Por que cachear a série de ~10 dias e não 1 requisição/cidade/dia

Com 115 cidades costeiras e cota de 50 requisições/dia, uma chamada por
cidade por dia consumiria 115 requisições/dia -- acima da cota. Solução:
atribuir a estação mais próxima 1x por cidade (gravada em
`cities.tide_station_id`/`tide_station_type`/`tide_station_distance_km`)
e, na sequência, buscar de uma vez a série prevista de ~10 dias. O nível
atual é interpolado da série em cache (`tidecheck_cache.time_series`),
sem nova chamada de rede a cada leitura de score. Regime permanente:
~13-15 cidades/dia dentro da cota, reabastecendo a série antes que vença.

## Por que uma tabela `tidecheck_cache` separada

`tide_cache` já existia com schema diferente (voltado à tábua do CPTEC).
Separar evita conflito de schema e mantém o histórico de cada fonte
independente -- ver migração `038_tidecheck_cache.sql`.

## UHSLC vs FES2022

Preferência por estação real de medição (UHSLC) quando disponível dentro
do raio de busca; FES2022 (modelo harmônico global, sem estação física)
como fallback pras cidades sem estação real próxima. Decidido em
`findBestStation()` (`lib/tidecheck.ts`).

## Estações reais (UHSLC) atribuídas hoje -- 9 de 32 cidades

Verificado ao vivo em `cities.tide_station_id`/`tide_station_type`:

| Cidade/UF | Estação UHSLC | Distância |
|---|---|---|
| Alcântara/MA | `madeira-715a-bra-uhslc_rq` | 29km |
| Araioses/MA | `luis_correia-711a-bra-uhslc_rq` | 46km |
| Areia Branca/RN | `termisa-284a-bra-uhslc_rq` | 18km |
| Bacabeira/MA | `madeira-715a-bra-uhslc_rq` | 36km |
| Barcarena/PA | `belem_uscgs-229a-bra-uhslc_rq` | 23km |
| Belém/PA | `belem_uscgs-229a-bra-uhslc_rq` | 19km |
| Cabo de Santo Agostinho/PE (Suape) | `suape-710a-bra-uhslc_rq` | 12km |
| Cajueiro da Praia/PI | `luis_correia-711a-bra-uhslc_rq` | 35km |
| Caucaia/CE | `fortaleza-283c-bra-uhslc_rq` | 29km |

As outras 23 cidades já atribuídas usam FES2022 (sem estação real a
menos de ~50km). O rollout das 115 cidades costeiras continua via
`tide-update.yml` (cron diário, 03h UTC).

## Limitações conhecidas

- Plano gratuito: 50 requisições/dia (suficiente em regime normal de
  atribuição + reabastecimento)
- 115 cidades costeiras cadastradas (`tide_code`), 32 já com estação
  atribuída no momento desta ADR -- rollout completo estimado em mais
  alguns dias (~13-15 cidades/dia)
- `tidecheck_cache` (a série de maré propriamente dita, usada pra
  interpolar o nível atual) ainda não teve nenhuma rodada bem-sucedida
  de reabastecimento no momento desta ADR -- a atribuição de estação
  (`cities.tide_station_*`) e o cache da série (`tidecheck_cache`) são
  etapas distintas do mesmo cron; até a série ser buscada pela primeira
  vez pra uma cidade, ela continua caindo no fallback neutro (0,5)
  mesmo já tendo estação atribuída
- A previsão de risco de 7 dias (`/api/forecast/[neighborhoodId]`) usa a
  mesma lógica cache-only do score ao vivo (`getTideLevelCacheOnly`) --
  ver fix relacionado nesta mesma leva de correções

## Consequências

- `tide_level` passa a refletir dado real (UHSLC) ou modelado (FES2022)
  pras cidades com estação atribuída E série já cacheada, em vez de
  neutro fixo
- Regra 2 (crítico automático por maré alta + chuva costeira) volta a
  poder disparar pra essas cidades
- Fallback 0,5 (neutro) continua ativo pras cidades sem `tide_code`, sem
  estação atribuída ainda, ou com cache de série vencido/vazio
