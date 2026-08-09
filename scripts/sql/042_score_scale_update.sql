-- Rescala do score de 0-1/3 níveis pra 1-10/5 níveis (normal/attention/
-- moderate/high/critical) -- ver lib/constants.ts (SCORE_THRESHOLDS/
-- getLevelFromScore) e lib/score.ts (calculateScore) pro código
-- correspondente, já implantado junto com esta migração.
--
-- Correções em relação à especificação original que motivou esta migração:
--
-- 1. A ordem original aplicava a CHECK constraint nova (score BETWEEN 1
--    AND 10) ANTES de converter os dados -- Postgres valida uma constraint
--    nova contra TODAS as linhas já existentes no momento do ADD CONSTRAINT
--    (a menos que declarada NOT VALID), e as ~1M linhas de risk_scores
--    ainda estavam em escala 0-1 nesse ponto. Rodar nessa ordem teria
--    falhado a migração inteira. Corrigido primeiro reordenando só o ADD
--    pra depois da conversão -- mas isso sozinho AINDA falhava: a
--    constraint ANTIGA (score BETWEEN 0 AND 1) continua ativa até ser
--    explicitamente removida, e o UPDATE do passo 1 abaixo escreve valores
--    >1 enquanto ela ainda existe, violando-a na hora (erro real reproduzido
--    tentando aplicar isso contra o banco de produção: "new row for
--    relation risk_scores violates check constraint risk_scores_score_
--    check" -- a migração inteira foi revertida pelo Postgres, transação
--    implícita de múltiplos statements em uma query simples). A ordem
--    correta é: derrubar a constraint ANTIGA primeiro, converter os dados,
--    só então criar a constraint NOVA.
--
-- 2. app é produção ao vivo -- deploy de código (Vercel) e esta migração
--    não são atômicos. Pode existir uma janela onde código ainda não
--    implantado grava score na escala antiga (0-1) depois desta migração
--    já ter rodado. O UPDATE de score abaixo é idempotente via
--    `WHERE score <= 1`: rodar de novo (mop-up manual pós-deploy) só
--    converte o que ainda não foi convertido, sem re-multiplicar linhas
--    já na escala nova (todo score válido na escala 1-10 é sempre > 1,
--    exceto o próprio piso 1 -- ver nota abaixo).
--
-- 3. A reclassificação de `level` da especificação original cobria só 2
--    transições (attention->moderate, critical->high) via UPDATE parcial
--    condicionado ao level ANTIGO -- não recalculava level pra linhas que
--    deveriam sair de "normal" e entrar em qualquer um dos 4 níveis
--    superiores, por exemplo. Trocado por um CASE completo que recalcula
--    level pra TODA linha a partir do score (já na escala 1-10) e de
--    auto_critical, espelhando getLevelFromScore -- correto e idempotente
--    independente de quantas vezes rodar.

-- 1. Derrubar as constraints ANTIGAS primeiro -- precisam sumir antes do
--    UPDATE de dado abaixo, senão elas mesmas rejeitam os valores novos
--    que ainda não cabem no CHECK antigo (0-1 / 3 níveis).
ALTER TABLE risk_scores
  DROP CONSTRAINT IF EXISTS risk_scores_score_check;

ALTER TABLE risk_scores
  DROP CONSTRAINT IF EXISTS risk_scores_level_check;

-- 2. Converter score de 0-1 pra 1-10 (idempotente -- só toca linha ainda
--    não convertida). Mínimo 1 em vez de 0 pra comunicação mais intuitiva
--    ("todo bairro tem algum risco basal"), mesma regra de lib/score.ts.
UPDATE risk_scores
SET score = GREATEST(1, LEAST(10, score * 10))
WHERE score <= 1;

-- 3. Recalcular level a partir do score já convertido -- mesma regra de
--    getLevelFromScore (lib/constants.ts): auto_critical sempre crítico,
--    senão comparação contra os limiares, do mais severo pro menos severo.
UPDATE risk_scores
SET level = CASE
  WHEN auto_critical = true THEN 'critical'
  WHEN score >= 8.0 THEN 'critical'
  WHEN score >= 6.5 THEN 'high'
  WHEN score >= 5.0 THEN 'moderate'
  WHEN score >= 3.0 THEN 'attention'
  ELSE 'normal'
END;

-- 4. Só agora criar as constraints NOVAS, com os dados já convertidos.
ALTER TABLE risk_scores
  ADD CONSTRAINT risk_scores_score_check
  CHECK (score >= 1 AND score <= 10);

ALTER TABLE risk_scores
  ADD CONSTRAINT risk_scores_level_check
  CHECK (level IN ('normal', 'attention', 'moderate', 'high', 'critical'));

-- 5. city_risk_summary.worst_level -- os 3 valores hoje em uso (normal/
--    attention/critical) já são um subconjunto válido do novo CHECK de 5
--    valores, então não precisa converter nenhum dado existente aqui (a
--    tabela é reescrita a cada ciclo do cron via upsertCityRiskSummary,
--    lib/riskScoring.ts, que já vai gravar os 5 valores novos dali em
--    diante). Só alargar a constraint.
ALTER TABLE city_risk_summary
  DROP CONSTRAINT IF EXISTS city_risk_summary_worst_level_check;

ALTER TABLE city_risk_summary
  ADD CONSTRAINT city_risk_summary_worst_level_check
  CHECK (worst_level IN ('normal', 'attention', 'moderate', 'high', 'critical'));
