# Arquitetura do Banco de Dados — Aprendizados

## Contexto
Problemas recorrentes de tamanho do banco em agosto/2026
levaram a investigações e decisões arquiteturais importantes.

## O problema do bloat de TOAST

### O que aconteceu
municipalities tinha 163MB reportados pelo Supabase,
mas o dado lógico real era apenas 3.2MB (média 596 bytes/linha).
Os 160MB eram bloat de TOAST — versões antigas de linhas
nunca limpas pelo autovacuum.

### Como identificar
```sql
-- Comparar tamanho total vs dado real
SELECT pg_size_pretty(pg_total_relation_size('public.municipalities'));
-- vs
SELECT pg_size_pretty(sum(pg_column_size(municipalities.*)))
FROM municipalities;
```

### Solução
VACUUM FULL municipalities — recuperou ~158MB em segundos.

### Prevenção
Monitor de bloat adicionado em monitor_health.py.
Detecta tabelas com >50% de linhas mortas.

## Retenção de risk_scores

### Decisão
Reduzido de 48h para 24h em agosto/2026.

### Raciocínio
- 28.483 bairros × ~6MB/hora = ~144MB/dia
- Com 48h de retenção: ~288MB só de risk_scores
- Com municipalities (163MB bloat) + neighborhoods (51MB):
  banco estourava ciclicamente
- Com 24h: ~72MB de risk_scores, banco estável abaixo de 300MB

### Impacto no produto
- Gráfico histórico no DetailPanel: mostra 24h em vez de 48h
- Dados históricos: continuam no B2 (archive 2x/dia)

## Archive para B2

### Cadência atual
2x/dia: 02h e 14h UTC
(era 1x/dia antes de agosto/2026)

### Por que 2x/dia
Com 1x/dia, o pico antes do archive chegava a 72h de backlog
(48h de retenção + 24h até próxima execução).
Com 2x/dia, pico máximo de ~36h.

## Duplicatas em risk_scores

### O problema
Lock TTL de 10min era apertado para execuções com banco lento.
Se o cron demorava ~10min, o lock expirava como "stale" e
uma segunda execução iniciava, duplicando toda a rodada.

### Solução implementada
- Lock TTL: 10min → 20min
- Índice único: risk_scores_neighborhood_hour_uniq
- ON CONFLICT DO NOTHING no INSERT

## municipalities — investigação de migração para B2

### Hipótese inicial
163MB de polígonos estáticos poderiam ser movidos para B2,
liberando espaço permanente no Supabase.

### Conclusão
Desnecessário. O dado real é apenas 3.2MB — o tamanho
inflado era 100% bloat de TOAST. VACUUM FULL resolveu.

### Como o endpoint funciona
- Filtra por bbox mas na prática retorna todos os 5.567 municípios
- Cache-Control: max-age=300 (mistura geometria + scores)
- Chamado uma vez por carregamento, só em zoom < 10
- Score e geometria retornados juntos — separar seria over-engineering

## archived_at em risk_scores (migração 045)

### Problema que resolveu
O archive relia o backlog inteiro do banco a cada execução
para verificar o que já estava no B2 (proteção contra
sobrescrever lotes parciais). Com 284.830 linhas presas,
isso gerava ~57MB de egress por execução × 60x/mês =
~3.4GB/mês só do archive — contribuição significativa
para o egress de 20GB/mês identificado em agosto/2026.

### Solução
Coluna `archived_at timestamptz DEFAULT NULL` em risk_scores.

Fluxo anterior:
1. SELECT todas as linhas > 24h (relê tudo)
2. Verifica existência no B2 (leitura-antes-de-gravar)
3. Upload para B2
4. DELETE do banco

Fluxo atual:
1. SELECT linhas > 24h WHERE archived_at IS NULL (lê só novas)
2. Lê arquivo existente do B2 (merge — mantém lotes anteriores)
3. Upload para B2
4. UPDATE archived_at = NOW()
5. DELETE WHERE archived_at IS NOT NULL (passo separado,
   deleteArchivedRiskScores — resiliente a falha no meio)

### Por que manter readFromB2
O archive processa em lotes de 50.000 por estado.
Sem ler o que já está no B2, cada lote sobrescreveria
o arquivo do dia, perdendo execuções anteriores —
bug já documentado e corrigido antes desta mudança.
O ganho de egress vem da seleção WHERE archived_at IS NULL
(o Postgres nunca reseleciona uma linha já arquivada),
não da remoção da verificação no B2.

### Índice parcial
```sql
CREATE INDEX risk_scores_not_archived_idx
ON risk_scores (calculated_at)
WHERE archived_at IS NULL;
```
Garante que a seleção seja eficiente mesmo com
milhões de linhas já arquivadas acumuladas.

## merge_cache far — deleção direta (sem archive)

### Decisão
merge_cache WHERE is_near_neighborhood = false não é
arquivado no B2. Motivo: células longe de qualquer bairro
nunca entram no cálculo de score e não têm valor histórico.

Tentativa de arquivar resultava em 0 bytes no B2 por razão
não determinada (runs reportavam sucesso sem arquivar de fato
— 94.261 linhas de um único dia sem nenhum byte no arquivo
correspondente, enquanto near do mesmo período tinha
cobertura completa).

Solução: deleção direta por corte de retenção (> 1 dia),
sem tentar B2 — documentada no código (deleteFarMergeCache,
scripts/archive_to_b2.ts) como decisão intencional.

## Tabela de migrações

| Migração | O que faz |
|---|---|
| 039 | REVOKE EXECUTE em funções administrativas |
| 040 | Índice único risk_scores_neighborhood_hour_uniq |
| 041 | Políticas RLS de negação explícita em 4 tabelas |
| 042 | Escala de score 1-10, 5 níveis |
| 043 | cities_with_errors em cron_run_stats |
| 044 | soil_moisture em weather_cache e risk_scores |
| 045 | archived_at em risk_scores + índice parcial |
