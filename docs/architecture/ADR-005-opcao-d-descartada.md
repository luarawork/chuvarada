# ADR-005: Opção D descartada (processar só cidades com chuva)

**Status:** Rejeitado

## Contexto

O Cron A processa os 28.483 bairros nacionais toda hora, mesmo em
cidades completamente secas. Uma proposta ("Opção D") era processar só
cidades com chuva detectada no MERGE, reduzindo o volume de trabalho por
ciclo.

## Decisão

**Não implementar.**

## Motivo

Bairros fora das células com chuva detectada ficariam com o score
congelado no último cálculo — ignorando maré, vento, umidade e
`rain_1h` da Open-Meteo, que continuam mudando independentemente de
haver chuva na célula. Em um app de segurança pública, dado congelado é
uma regressão inaceitável: um bairro pode passar de normal pra risco por
uma combinação de fatores que não envolve chuva nova na própria célula
(ex: maré alta chegando depois que a chuva já passou).

## Consequências

- O Cron A continua processando a base inteira a cada ciclo. A otimização
  de custo/tempo veio por outro caminho: o cache de neighborhoods no B2
  (ver [ADR-002](ADR-002-cache-neighborhoods-b2.md)), que reduz o custo
  de LER os bairros, sem deixar nenhum de fora do recálculo.
