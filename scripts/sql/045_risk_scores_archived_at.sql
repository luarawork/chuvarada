-- Marca risk_scores como arquivado em vez de deletar na hora do upload pro
-- B2 -- desacopla "já subi pro B2" de "já apaguei do Supabase", resiliente a
-- falha no meio (se o processo cair depois do upload mas antes do delete, a
-- linha já marcada não é reselecionada nem reenviada de novo no próximo run).
ALTER TABLE risk_scores
ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL;

-- Índice parcial -- o archive só busca linhas ainda não arquivadas.
CREATE INDEX IF NOT EXISTS risk_scores_not_archived_idx
ON risk_scores (calculated_at)
WHERE archived_at IS NULL;
