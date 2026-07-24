# Diagnóstico de cobertura — Nordeste + Sul + Sudeste

Data: 21/07/2026. Levantamento read-only (nenhum dado ou código alterado)
após a expansão nacional (Sul + Sudeste, 7 estados) e a task que foi
interrompida no meio do primeiro ciclo de cron pós-upload.

## Resumo executivo

| Métrica | Valor |
|---|---|
| Estados cobertos | 16 (9 Nordeste + 7 Sul/Sudeste) |
| Municípios cadastrados | 4.653 — bate 100% com os manifestos do IBGE em todos os 16 estados |
| Bairros/distritos | 24.556 |
| Com score calculado | 24.556 / 24.556 (**100%**) |
| Municípios sem nenhum bairro | **0** |
| Bairros sem score (nunca processados) | **0** |

Nenhuma lacuna estrutural encontrada. A task interrompida (ver seção
seguinte) não deixou rastro — o segundo ciclo de cron, rodado depois que
o `merge_cache`/upload haviam assentado, cobriu os 16 estados por completo.

### Por estado (municípios / bairros / score / distribuição de nível)

| Estado | Municípios | Bairros | Com score | Score médio | Crítico | Atenção | Normal |
|---|---:|---:|---:|---:|---:|---:|---:|
| AL | 102 | 240 | 240 (100%) | 0,213 | 0 | 0 | 240 |
| BA | 417 | 1.306 | 1.306 (100%) | 0,196 | 0 | 4 | 1.302 |
| CE | 184 | 2.197 | 2.197 (100%) | 0,187 | 0 | 5 | 2.192 |
| MA | 217 | 415 | 415 (100%) | 0,173 | 0 | 0 | 415 |
| PB | 223 | 551 | 551 (100%) | 0,217 | 0 | 15 | 536 |
| PE | 185 | 1.056 | 1.056 (100%) | 0,218 | 0 | 56 | 1.000 |
| PI | 224 | 702 | 702 (100%) | 0,163 | 0 | 0 | 702 |
| RN | 167 | 375 | 375 (100%) | 0,260 | 88 | 21 | 266 |
| SE | 75 | 275 | 275 (100%) | 0,236 | 0 | 1 | 274 |
| **PR** | 399 | 1.778 | 1.778 (100%) | 0,207 | 4 | 134 | 1.640 |
| **SC** | 295 | 2.175 | 2.175 (100%) | 0,241 | 0 | 273 | 1.902 |
| **RS** | 497 | 3.596 | 3.596 (100%) | 0,442 | 745 | 2.674 | 177 |
| **SP** | 645 | 3.185 | 3.185 (100%) | 0,189 | 0 | 0 | 3.185 |
| **RJ** | 92 | 1.802 | 1.802 (100%) | 0,211 | 0 | 0 | 1.802 |
| **MG** | 853 | 3.872 | 3.872 (100%) | 0,218 | 0 | 2 | 3.870 |
| **ES** | 78 | 1.031 | 1.031 (100%) | 0,230 | 0 | 9 | 1.022 |

RN com 88 críticos e RS com 745 críticos + 2.674 em atenção (~95% do
estado) refletem chuva real no momento da consulta (RS com sistema
frontal ativo — ver relatório da expansão, `rain_source =
max_merge_openmeteo` em ~103-107mm/72h), não anomalia de dado.

## Impacto da task interrompida

A primeira tentativa de rodar o cron pós-upload (900s) foi cortada pelo
timeout do cliente no meio do processamento — confirmado na hora via
`cron_run_stats` (não tinha linha nova para aquele ciclo). Isso deixou
temporariamente ES zerado e MG a 32% na época.

**Estado agora, depois do segundo ciclo completo:**

| Estado | Municípios no banco | Municípios no manifesto (esperado) | Diferença |
|---|---:|---:|---:|
| PR | 399 | 399 | 0 |
| SC | 295 | 295 | 0 |
| RS | 497 | 497 | 0 |
| SP | 645 | 645 | 0 |
| RJ | 92 | 92 | 0 |
| MG | 853 | 853 | 0 |
| ES | 78 | 78 | 0 |

Todos os 7 estados batem exatamente com o manifesto gerado no
processamento original. **Nenhum reprocessamento necessário** — o
segundo ciclo (rodado depois que merge_cache e upload haviam assentado)
resolveu completamente a lacuna deixada pela interrupção. Nenhum outro
estado (Nordeste) foi afetado.

## Qualidade dos dados

### terrain_slope

Só **2 bairros** (de 17.439 novos) ficaram com o placeholder 0,5, ambos
em SC — via de regra o cálculo real via SRTM (feito antes do upload,
diferente do Nordeste que subiu com placeholder e corrigiu depois) já
cobriu praticamente tudo. Slope médio por estado varia de 0,352 (PR,
mais plano) a 0,532 (MG, mais montanhoso) — coerente com a geografia real
(Serra da Mantiqueira/Caparaó em MG/ES vs planície costeira no PR).

### hydro_proximity

43 bairros com `hydro_proximity = 0` (0,25% dos 17.439 novos) — bem
menor proporcionalmente que o problema de bbox encontrado no Nordeste
(que afetou centenas de bairros em MA/PB/PI/PE):

| Estado | Bairros com hydro_proximity = 0 |
|---|---:|
| RS | 16 |
| RJ | 17 |
| SP | 8 |
| ES | 2 |
| PR, SC, MG | 0 |

O bbox usado no cálculo (`-57.7, -33.8, -39.6, -14.2`, união dos 7
bboxes individuais dos estados) já é bem mais generoso que os shapefiles
em si, então **não parece ser corte de borda igual ao caso do
Nordeste**. A amostra inspecionada mostra dois padrões distintos:

- **Rio Grande (RS)**: 15 dos 16 zeros do estado, incluindo bairros com
  nome "Unidade Censitária NN" (nomenclatura do próprio IBGE pra área do
  porto/zona industrial) — pode ser área onde a hidrografia mapeada pela
  BHO genuinamente não tem curso d'água próximo (zona portuária
  aterrada), ou pode ser uma classificação diferente (canal/estuário) não
  capturada pela camada `curso_dagua` usada.
  
- **Santos (SP)**: 4 bairros centrais (Gonzaga, José Menino, Marapé,
  Morro Embaré) — todos claramente à beira-mar/estuário, o que torna
  suspeito. Mais provável: a BHO classifica o canal do porto de
  Santos/estuário como outra coisa que não `curso_dagua`, então não
  aparece pra medir proximidade — mas o modelo já compensa isso
  parcialmente via `is_coastal=true` nesses bairros (que pesa
  separadamente no score).

Não é urgente (43 bairros é uma fração mínima), mas vale investigar se
alargar o filtro de tipo de canal em `process_bho.py` resolveria os
casos de Santos.

### Achado não pedido, mas relevante: `name_source` não é gravado no upload

Ao investigar municípios com só 1 bairro (ver próxima seção), percebi
que `upload_state_expansion.js` nunca grava a coluna `name_source` —
o INSERT não inclui esse campo, embora `process_state_neighborhoods.py`
já calcule e grave esse valor no GeoJSON de origem. Isso vale pros 16
estados inteiros processados via pipeline estadual (não é um problema
novo desta expansão, é pré-existente desde o primeiro batch Nordeste) —
`neighborhoods.name_source` fica `NULL` pra todo bairro que não veio do
pipeline por cidade original (Salvador/Recife/Natal).

Não corrigi (fora do escopo — só diagnóstico), mas é uma correção
barata: 1 linha a mais no INSERT de `upload_state_expansion.js`.

## Municípios com apenas 1 bairro (Sul/Sudeste)

| Estado | Municípios c/ 1 bairro | Total municípios | % |
|---|---:|---:|---:|
| SP | 421 | 645 | 65% |
| MG | 388 | 853 | 45% |
| PR | 194 | 399 | 49% |
| RS | 187 | 497 | 38% |
| SC | 123 | 295 | 42% |
| RJ | 17 | 92 | 18% |
| ES | 10 | 78 | 13% |

Como a coluna `name_source` do banco está `NULL` (achado acima), cruzei
direto com os GeoJSONs de origem em vez da tabela: **100% desses casos
têm `name_source = 'distrito'`** — nenhum caiu no fallback final de
`'setor'` (que indicaria ausência total de distrito/subdistrito
nomeado). Ou seja, são municípios onde o IBGE não registrou nenhum
`NM_BAIRRO` nos setores censitários e o município inteiro é um único
distrito-sede — **exatamente o caso esperado e documentado no
docstring de `process_state_neighborhoods.py`**, não um bug ou
processamento incompleto. A proporção alta em SP/MG é coerente com a
realidade: os dois estados têm centenas de municípios pequenos no
interior, tipicamente 1 distrito só.

## Cobertura de maré no litoral Sul/Sudeste

121 municípios costeiros nos 6 estados com litoral (PR, SC, RS, SP, RJ,
ES — MG não tem costa). Só 6 têm `tide_code` (os pesquisados na
expansão original: Paranaguá, Florianópolis, Rio Grande, Rio de
Janeiro, Santos, Vitória) — os outros 115 ficaram sem.

| Estado | Municípios costeiros | Com tide_code | Sem tide_code |
|---|---:|---:|---:|
| ES | 14 | 1 | 13 |
| PR | 7 | 1 | 6 |
| RJ | 25 | 1 | 24 |
| RS | 28 | 1 | 27 |
| SC | 31 | 1 | 30 |
| SP | 16 | 1 | 15 |

Municípios costeiros relevantes (por nº de bairros costeiros) hoje sem
código: **Angra dos Reis (115 bairros costeiros!)**, Vila Velha (59),
Ubatuba (59), Ilhabela (49), Guarujá (39), São Sebastião (38), Macaé
(38), Itanhaém (38), Niterói (33), Porto Alegre (33), Praia Grande (32).

**Recheguei o catálogo completo do CPTEC**
(`ondas.cptec.inpe.br/~rondas/mares`) pra PR/SC/RS/SP/RJ/ES — a lista
inteira de estações disponíveis nesses 6 estados é:

| Código | Estação | Estado | Município correspondente (a confirmar) |
|---|---|---|---|
| 40240 | Terminal de Barra do Riacho | ES | Aracruz (a confirmar) |
| 40252 | Porto de Vitória | ES | **Vitória — já atribuído** |
| 40255 | Porto do Tubarão | ES | Provavelmente dentro do território de Vitória — checar se é redundante com 40252 |
| 40280 | Terminal da Ponta do Ubu | ES | Anchieta (a confirmar) |
| 50116 | Terminal Marítimo de Imbetiba | RJ | Macaé (a confirmar — Imbetiba é bairro/porto conhecido de Macaé) |
| 50140 | Porto do Rio de Janeiro | RJ | **Rio de Janeiro — já atribuído** |
| 50145 | Porto de Itaguaí | RJ | Itaguaí (a confirmar) |
| 50156 | Porto do Forno | RJ | Arraial do Cabo (a confirmar) |
| 50165 | Terminal da Ilha Guaíba | RJ | Mangaratiba (a confirmar) |
| 50170 | Porto de Angra dos Reis | RJ | Angra dos Reis (a confirmar) — maior município costeiro sem código hoje |
| 50210 | Porto de São Sebastião | SP | São Sebastião (a confirmar) |
| 50225 | Porto de Santos | SP | **Santos — já atribuído** |
| 60130/60135 | Barra do Porto de Paranaguá (canais) | PR | Paranaguá — mesmo porto do 60132, provavelmente redundante |
| 60132 | Porto de Paranaguá | PR | **Paranaguá — já atribuído** |
| 60139 | Terminal Portuário da Ponta do Félix | PR | Antonina (a confirmar) |
| 60220 | Porto de São Francisco do Sul | SC | São Francisco do Sul (a confirmar) |
| 60235 | Porto de Itajaí | SC | Itajaí (a confirmar) |
| 60245 | Porto de Florianópolis | SC | **Florianópolis — já atribuído** |
| 60250 | Porto de Imbituba | SC | Imbituba (a confirmar) |
| 60370 | Porto do Rio Grande | RS | **Rio Grande — já atribuído** |

RS não tem nenhuma estação adicional no catálogo além de Rio Grande —
Porto Alegre, Tramandaí e os demais municípios do litoral gaúcho
ficam sem cobertura de maré real disponível no CPTEC (esperar
fallback neutro/redistribuição de peso, já implementado).

**8 códigos novos identificados e prontos pra atribuir** (Angra dos
Reis, Imbituba, São Sebastião, São Francisco do Sul, Itajaí, mais
Macaé/Itaguaí/Arraial do Cabo/Mangaratiba/Antonina/Anchieta/Aracruz a
confirmar contra o nome exato do porto) — nenhum foi aplicado agora,
por estar fora do escopo deste diagnóstico (só relatar).

## Recomendações

### Antes do próximo deploy
- Nenhuma — a expansão está estruturalmente completa (100% de score,
  0 município sem bairro, 0 bairro sem score). Não há bloqueador.

### Pode ficar para depois
1. Atribuir os ~5-8 tide_codes adicionais já identificados no catálogo
   CPTEC (Angra dos Reis é o de maior impacto — 115 bairros costeiros).
   Confirmar cada mapeamento porto→município antes de aplicar (mesmo
   cuidado que corrigiu o código errado de Ilhéus na expansão do
   Nordeste).
2. Investigar os 43 bairros com `hydro_proximity = 0` — em especial os
   4 de Santos (claramente à beira-mar), que sugerem um filtro de tipo
   de canal/estuário faltando em `process_bho.py`.
3. Corrigir `upload_state_expansion.js` pra gravar `name_source` no
   INSERT — barato, e destrava esse diagnóstico ser feito direto no
   banco em vez de precisar cruzar com os GeoJSONs de origem.
4. Os 2 bairros de SC com `terrain_slope` ainda placeholder (0,5) —
   volume ínfimo, mas fácil de fechar com o mesmo script usado nos
   outros 17.437.
