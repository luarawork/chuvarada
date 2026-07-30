# ADR-004: Pesos regionais estruturados (calibração futura)

**Status:** Aceito

## Contexto

O Brasil tem padrões de chuva muito diferentes por região — chuva
convectiva localizada no Nordeste versus frentes frias que cobrem o
estado inteiro no Sul, por exemplo. Um único conjunto de pesos nacional
pode não representar bem esses regimes tão distintos.

## Decisão

Criar `lib/scoreConfig.ts` com 5 regiões (`nordeste`, `sul`, `sudeste`,
`centro-oeste`, `norte`), cada uma mapeada a partir do estado
(`REGION_BY_STATE`) e associada a um conjunto de pesos
(`SCORE_WEIGHTS_BY_REGION`). Hoje todas as 5 regiões usam os mesmos
valores — a estrutura existe pronta para calibração futura, mas os
números em si ainda não foram diferenciados.

## Por que não calibrar agora

Calibrar pesos por região sem base científica poderia piorar o modelo em
vez de melhorá-lo. Requer validação por hidrólogo ou meteorologista com
dados históricos de cada região — trabalho fora do escopo de
desenvolvimento de software puro.

## Consequências

- Qualquer calibração futura é uma mudança de configuração
  (`SCORE_WEIGHTS_BY_REGION`), não uma reescrita de `lib/score.ts`.
- Alterar esses pesos exige aprovação (ver
  [CONTRIBUTING.md](../../CONTRIBUTING.md), seção "Nunca fazer sem
  aprovação").
