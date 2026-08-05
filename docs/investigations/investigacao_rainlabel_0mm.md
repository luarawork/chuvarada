# Investigação: cards de "Próximas horas" mostrando "0mm"/"0" pra chuva fraca

Diagnóstico que levou à correção já aplicada em `rainLabel()`
(`components/panel/HourlyForecast.tsx`) — ver teste de regressão em
`tests/regression/critical-bugs.test.ts`.

## Sintoma reportado

Em bairros com chuva de verdade, os cards de "Próximas horas" (aba de
clima hora a hora do painel de bairro) mostravam ora "0mm" ora "0" sem
unidade, dando a impressão de que nenhum card refletia chuva real.

## Causa raiz

`rainLabel()` decidia se mostrava a unidade "mm" usando o valor **bruto**
(`rain > 0`), mas o número exibido já tinha passado por `Math.round()`
(sem casas decimais). Chuva fraca real entre 0,1mm e 0,49mm: `rain > 0` é
verdadeiro (mostra "mm"), mas `Math.round(0,3)` = 0 — resultado exibido:
"0mm". Chuva zero de verdade: `rain > 0` é falso, número arredondado
também é 0 — resultado exibido: "0" sem unidade. Os dois casos pareciam
idênticos ("praticamente tudo em 0"), mas representavam situações
diferentes (chuva real fraca vs. ausência de chuva).

## Verificação de que não era bug de dado

Antes de mexer no componente, o pipeline de dados foi verificado
comparando a saída de `/api/forecast` diretamente com a API bruta do
Open-Meteo pras mesmas coordenadas — os valores batiam. O bug era
inteiramente de exibição, não de cálculo ou de fonte de dado.

## Correção aplicada

`rainLabel()` agora: `rain === 0` → string vazia; `rain < 1` → `"<1mm"`
literal; `rain >= 1` → valor arredondado + `"mm"`.
