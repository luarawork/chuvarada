# ADR-006: Salvaguarda para MERGE estagnado

**Status:** Aceito

## Contexto

Caso real (Naviraí/Itaquiraí, MS, 30/07/2026): o MERGE ficou com
`rain_72h`/`rain_peak_3h` travados em ~120mm por 45+ horas depois que a
chuva real (~101mm em 22-24/07) já tinha passado. `fetched_at` sozinho
não detectava isso, porque o UPSERT condicional (ver
[ADR-003](ADR-003-upsert-condicional-merge-cache.md)) também atualiza
`fetched_at` quando só `is_near_neighborhood` muda — sem chuva nenhuma
mudar de verdade. As duas cidades ficaram em crítico por 259h após a
chuva já ter passado.

## Decisão

Adicionar `last_changed_at` em `merge_cache` (migração 037) — uma coluna
separada de `fetched_at` que só avança quando `rain_72h` OU
`rain_peak_3h` mudam de verdade. Em `getBestRainData()`
(`lib/weather.ts`): se `last_changed_at` estiver há mais de 24h sem
mudar, o MERGE é tratado como não confiável mesmo com `fetched_at`
recente, e a Open-Meteo passa a ser usada sozinha em vez de entrar no
`max()` com o MERGE — que só reforçaria o valor travado.

## Consequências

- Cron A loga e reporta (`stagnant_merge_cells` na resposta do endpoint)
  quantas células ficaram estagnadas em cada rodada.
- `rain_source` ganhou um novo valor possível: `"openmeteo_merge_stale"`.
