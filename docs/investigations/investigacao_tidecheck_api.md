# Investigação: API da TideCheck (tidecheck.com)

Diagnóstico apenas, feito antes de implementar a integração (ver
[ADR-009](../architecture/ADR-009-tidecheck-integration.md) pra decisão e
resultado final). Objetivo: entender a API o suficiente pra decidir se dava
pra substituir o fallback neutro do CPTEC/INPE (fora do ar desde 2018) sem
estourar a cota gratuita.

## Tipos de estação

O catálogo de estações da TideCheck mistura dois tipos, distinguíveis pelo
próprio `station_id`:

- **UHSLC** (sufixo `-uhslc_rq`): estação de medição real, rede
  University of Hawaii Sea Level Center.
- **FES2022**: ponto de um modelo harmônico global (sem estação física) —
  usado como fallback quando não há estação UHSLC dentro do raio de busca.

## Datum e normalização

A altura de maré retornada usa o datum **LAT** (Lowest Astronomical Tide)
da própria estação, não um datum universal — por isso a normalização
adotada (`(altura_atual - min) / (max - min)`) usa o min/máx da própria
janela de série retornada, em vez de um valor fixo global.

## Estrutura da resposta

Dois recursos relevantes por estação: `timeSeries` (série temporal
contínua, usada pra interpolar o nível em qualquer instante dentro da
janela) e `extremes` (só os picos de maré alta/baixa, mais leve, mas
insuficiente sozinho pra interpolar um instante qualquer). A integração
final usa `timeSeries` com uma janela de ~10 dias por busca.

## Rate limit

Confirmado via headers da própria resposta HTTP (não documentado de forma
explícita na doc pública): **50 requisições/dia** no plano gratuito. Esse
número foi o que forçou o desenho de cache descrito no ADR-009 (atribuir
estação 1x por cidade + cachear a série de ~10 dias, em vez de 1
requisição por cidade por dia — 115 cidades excederiam a cota nesse
modelo ingênuo).
