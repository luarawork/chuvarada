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

## Tabela de migrações

| Migração | O que faz |
|---|---|
| 039 | REVOKE EXECUTE em funções administrativas |
| 040 | Índice único risk_scores_neighborhood_hour_uniq |
| 041 | Políticas RLS de negação explícita em 4 tabelas |
| 042 | Escala de score 1-10, 5 níveis |
| 043 | cities_with_errors em cron_run_stats |
