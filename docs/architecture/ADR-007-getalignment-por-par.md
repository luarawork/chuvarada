# ADR-007: getAlignment por par de categorias

**Status:** Aceito

## Contexto

O cálculo original de alinhamento entre relato da comunidade e nível do
modelo era numérico (diferença entre a categoria do relato e a do
modelo, mapeadas pra uma escala comum). Isso produzia resultados não
intuitivos: a combinação Crítico (modelo) + Grave (relato) — o caso onde
comunidade e modelo mais concordam — podia aparecer como "Diverge
levemente" em vez de "Alinha", só por causa de como as duas escalas
foram deslocadas uma em relação à outra.

## Decisão

Substituir o cálculo numérico por um mapeamento explícito das 9
combinações possíveis (3 níveis do modelo × 3 gravidades de relato),
cada uma escrita por extenso.

## Consequências

- Mais fácil de auditar do que uma fórmula: qualquer par pode ser
  conferido lendo o mapeamento diretamente, sem recalcular nada.
- Adicionar um novo nível/gravidade no futuro exige atualizar o
  mapeamento manualmente (9 pares vira 12, 16 etc.) em vez de só ajustar
  uma fórmula — trade-off aceito em troca de previsibilidade.
