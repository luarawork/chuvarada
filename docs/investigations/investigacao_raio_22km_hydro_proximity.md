# Investigação: raio fixo de 22km em `hydro_proximity` prejudica a Amazônia?

Diagnóstico apenas — nenhuma mudança de código ou dado feita a partir desta
investigação. Pergunta original: o raio de busca fixo de 22km usado por
`process_bho_strahler.py` (ver [ADR-008](../architecture/ADR-008-strahler-hydro-proximity.md))
poderia estar prejudicando cidades amazônicas, onde os rios são muito mais
largos e espaçados do que no restante do país?

## Método

Comparação do `hydro_proximity` médio pós-Strahler entre capitais/cidades
da região amazônica (Manaus, Belém) e cidades do planalto Sul/Sudeste
(Curitiba, São Paulo), além de checagem geral de quais bairros ficaram com
os scores mais baixos nacionalmente.

## Conclusão

**Raio adequado — não é um problema real.** Manaus e Belém pontuam
*melhor* em `hydro_proximity` do que Curitiba e São Paulo, o oposto do que
a hipótese preveria. Os bairros com pior pontuação nacional não estão na
Amazônia — são cidades do interior do planalto Sul/Sudeste, longe de
qualquer curso d'água relevante, o que é o comportamento esperado (menos
hidrografia densa por perto = `hydro_proximity` genuinamente mais baixo,
não um artefato do raio de busca).

Não descartado por engano: é uma leitura direta do dado pós-reprocessamento,
não uma suposição. Ver [Roadmap](https://github.com/luarawork/chuvarada/wiki/Roadmap)
pra status geral do `hydro_proximity`.
