# ADR-002: Cache de neighborhoods no B2

**Status:** Aceito

## Contexto

O Cron A lia os 28.483 bairros inteiros do Supabase a cada hora — mesmo
já reduzido a 10 colunas (fix anterior), essa única query custava
~240MB/dia de egress, uma fração relevante do limite do plano gratuito.

## Decisão

Gerar um arquivo JSON comprimido (~2MB) no B2 uma vez por dia
(`scripts/generate_neighborhoods_cache.ts`, via
`regenerate-neighborhoods-cache.yml`), com a mesma query de 10 colunas
que o Cron A já usava. O Cron A passa a ler esse arquivo do B2 primeiro;
se a leitura falhar ou vier vazia, cai pro fallback direto no Postgres
(`app/api/cron/scores/route.ts`).

## Consequências

- Um bairro/cidade recém-cadastrado só aparece no cache depois da
  próxima regeneração diária ou de um `workflow_dispatch` manual — não é
  imediato.
- Sem cache em memória de módulo: o endpoint só roda 1x/hora via GitHub
  Actions, então cada invocação já bate num cold start (ou numa
  instância serverless diferente) de qualquer forma — um cache em
  memória nunca teria hit na prática.

## Alternativas consideradas

- **Cache em memória do processo** — descartado: ambiente serverless não
  mantém estado entre invocações do cron.
- **Opção D (processar só cidades com chuva detectada no MERGE)** —
  descartado: bairros fora das células chuvosas ficariam com score
  congelado, ignorando maré, vento, umidade e `rain_1h` da Open-Meteo que
  continuam mudando independente de chuva. Em app de segurança pública,
  dado congelado é uma regressão inaceitável (ver
  [ADR-005](ADR-005-opcao-d-descartada.md)).
