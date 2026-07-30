-- Diagnóstico de 30/07/2026 (Naviraí/Itaquiraí, MS): rain_72h ficou travado
-- em ~120mm por 45+ horas depois que a chuva real (~101mm em 22-24/07) já
-- tinha passado. `fetched_at` sozinho não detecta isso de forma confiável --
-- o UPSERT de fetch_merge_cptec.py também atualiza fetched_at quando só
-- is_near_neighborhood muda (sem chuva nenhuma mudar), então uma célula pode
-- parecer "fresca" por fetched_at mesmo com rain_72h/rain_peak_3h travados há
-- dias. last_changed_at rastreia especificamente isso: só avança quando
-- rain_72h OU rain_peak_3h muda de verdade.
ALTER TABLE merge_cache
ADD COLUMN IF NOT EXISTS last_changed_at timestamptz DEFAULT NOW();

-- Índice simples (não parcial) -- um predicado com now()/interval não é
-- permitido em índice parcial no Postgres (now() não é IMMUTABLE, erro
-- 42P17 "functions in index predicate must be marked IMMUTABLE" -- achado
-- ao aplicar esta migração). O índice completo já atende bem as consultas
-- de detecção de estagnação (comparação contra um timestamp calculado em
-- tempo de query, não no índice).
CREATE INDEX IF NOT EXISTS merge_cache_last_changed
ON merge_cache(last_changed_at);

-- Backfill pras linhas existentes -- fetched_at é a melhor aproximação
-- disponível pra dado já gravado antes desta migração (não temos como saber
-- retroativamente quando o rain_72h de cada linha antiga mudou de verdade
-- pela última vez).
UPDATE merge_cache
SET last_changed_at = fetched_at
WHERE last_changed_at IS NULL;
