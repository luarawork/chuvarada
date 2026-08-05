# Investigação: os 4 cards de "Métricas do produto" em `/analise`

Diagnóstico que levou às correções já aplicadas (ver
`app/api/analise/metrics/route.ts`, `app/analise/page.tsx`,
`lib/analiseMetrics.ts` e o teste de regressão correspondente em
`tests/regression/critical-bugs.test.ts`). Três problemas encontrados,
nenhum deles no cálculo em si — todos na camada de exibição/definição
da métrica.

## 1. Relatos de teste poluindo "Total de relatos"

As 2 únicas linhas de `user_reports` no banco de produção eram,
claramente, dado de teste: mesmo bairro (Graças/Recife), criadas com 2
minutos de diferença entre si, sem nenhum padrão de uso real. Removidas
via `scripts/one-off/delete_test_user_reports.js`.

## 2. "Cobertura de dados" inconsistente com sua própria tabela expandida

O card resumia `cities.data_level = 'full'` (granularidade mais alta:
hidrografia local processada + terreno real + nomenclatura oficial de
bairro) — só 10 de 5.570 cidades ativas, arredondando pra 0%. Mas clicar
no mesmo card abria uma tabela por estado mostrando "% com score"
(`pct_com_score`, baseado em `city_risk_summary`) perto de 100% em todos
os estados. Resumo e detalhe mediam coisas completamente diferentes sob
o mesmo rótulo. Corrigido unificando os dois pra medirem a mesma coisa:
% de cidades ativas com score calculado.

## 3. "Taxa média de confirmação" com amostra estatisticamente inútil

A query já filtrava correndo pra só considerar relatos com pelo menos uma
reação (`confirmations + denials > 0`), mas não havia piso de amostra —
com 1 único relato reagido, o card mostrava um percentual (ex: "100%")
como se fosse um dado confiável. Corrigido: abaixo de 5 relatos com
reação, o card mostra "—" em vez de um percentual.
