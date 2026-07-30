# ADR-003: UPSERT condicional no merge_cache

**Status:** Aceito

## Contexto

`fetch_merge_cptec.py` gravava as ~167 mil células do bbox nacional toda
hora, mesmo quando nada mudava — o produto MERGE DAILY só publica 1x/dia,
mas o cron roda de hora em hora. Isso gerava bloat de tuplas mortas
(`n_tup_upd` chegou a 2.360.911) sem nenhum ganho de dado.

## Decisão

Adicionar `WHERE ... IS DISTINCT FROM ...` no `ON CONFLICT DO UPDATE` do
UPSERT em lote. Só reescreve uma linha quando `rain_72h`, `rain_peak_3h`
ou `is_near_neighborhood` mudam de verdade — célula sem mudança real não
gera `UPDATE` nenhum, e portanto nenhuma tupla morta.

## Consequências

- `fetched_at` deixa de significar "última vez que o cron rodou" e passa
  a significar "última vez que o valor mudou" — distinção que, mais
  tarde, motivou a coluna separada `last_changed_at` quando ficou claro
  que `fetched_at` sozinho não bastava pra detectar estagnação real (ver
  [ADR-006](ADR-006-salvaguarda-merge-estagnado.md)).
- Reduz drasticamente o volume de `UPDATE`s por ciclo, já que a maior
  parte das ~167 mil células fica sem mudança de uma execução pra outra.
