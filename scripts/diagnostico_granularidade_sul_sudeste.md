# Diagnóstico de granularidade — Sul/Sudeste vs Nordeste

Data: 22/07/2026. Levantamento read-only (nenhum dado ou código alterado).

## Resumo executivo — a premissa do pedido não se confirma como regional

**A hipótese "Sul/Sudeste tem menos granularidade que o Nordeste" não se
sustenta olhando o conjunto dos 16 estados.** A média de bairros por
município é:

| Estado | Bairros/município | % nome real (`bairro`) |
|---|---:|---:|
| **RJ** | **19,6** | 83,3% |
| ES | 13,2 | 72,6% |
| CE | 11,9 | 59,6% |
| SC | 7,4 | 79,4% |
| RS | 7,2 | 62,3% |
| PE | 5,7 | 62,4% |
| SP | 4,9 | 68,0% |
| PR | 4,5 | 54,3% |
| MG | 4,5 | 51,5% |
| SE | 3,7 | 65,5% |
| PI | 3,1 | 68,2% |
| BA | 3,1 | 34,8% |
| PB | 2,5 | 46,6% |
| AL | 2,4 | 52,1% |
| RN | 2,2 | 49,3% |
| MA | 1,9 | 41,4% |

RJ tem a **maior** média de bairros/município de todos os 16 estados —
maior que qualquer estado do Nordeste. SC, RS e ES também superam a
maioria do Nordeste. **A granularidade real é uma questão por
município específico, não por região.** O problema que motivou este
pedido (áreas grandes sem dado no mapa) é concentrado em **poucas
cidades específicas**, não no Sul/Sudeste como um todo.

## O caso real: São Paulo (capital), Campinas e Sorocaba

Testei o shapefile bruto do Censo 2022 do IBGE para as 7 capitais do
Sul/Sudeste que você listou, direto (`NM_BAIRRO`/`NM_DIST`/`NM_SUBDIST`,
antes de qualquer processamento do pipeline):

| Capital | Setores censitários | `NM_BAIRRO` preenchido | Bairros reais únicos |
|---|---:|---:|---:|
| **São Paulo** | 27.301 | **0%** | **0** |
| Rio de Janeiro | 13.782 | 100% | 162 |
| Belo Horizonte | 5.166 | 100% | 476 |
| Curitiba | 3.190 | 100% | 75 |
| Porto Alegre | 2.744 | 100% | 94 |
| Florianópolis | 1.004 | 89% | 87 |
| Vitória | 680 | 98,5% | 80 |

**São Paulo é a única das 7 onde o Censo 2022 do IBGE não tem nenhum
`NM_BAIRRO` preenchido — em nenhum dos 27.301 setores censitários da
cidade.** Não é bug do pipeline nem do processamento: a informação
genuinamente não existe na fonte. O fallback (`NM_BAIRRO` →
`NM_SUBDIST` → `NM_DIST`) cai direto no nível mais grosso —
`NM_SUBDIST` também está 100% vazio para São Paulo, então sobra só
`NM_DIST`: os 96 distritos oficiais.

Isso **não é exclusivo da capital** — testando outras grandes cidades
de SP:

| Cidade (SP) | Bairros | Reais | Distritos |
|---|---:|---:|---:|
| Santo André | 114 | 113 | 1 |
| **São Paulo** | 96 | **0** | 96 |
| Osasco | 61 | 60 | 1 |
| Ribeirão Preto | 57 | 55 | 2 |
| Guarulhos | 48 | 47 | 1 |
| São José dos Campos | 37 | 35 | 2 |
| São Bernardo do Campo | 36 | 34 | 2 |
| **Campinas** | 7 | **0** | 7 |
| **Sorocaba** | 1 | **0** | 1 |

Santo André, Osasco, Ribeirão Preto, Guarulhos, São José dos Campos e
São Bernardo — todas cidades grandes de SP — têm bairro real
preenchido normalmente. **Só São Paulo, Campinas e Sorocaba
especificamente têm esse buraco no Censo 2022.** Não sei dizer, sem
mais pesquisa, se há um padrão comum entre essas 3 (ex: algo na forma
como a Secretaria Municipal cadastrou os setores desses 3 municípios
específicos junto ao IBGE) — fica como pergunta em aberto.

## Confirmando o impacto visual: área dos polígonos

| Cidade | Polígonos | Área total | Área média | Maior polígono |
|---|---:|---:|---:|---|
| **São Paulo** | 96 | 1.524,7 km² | **15,88 km²** | Marsilac, 208,2 km² |
| Rio de Janeiro | 162 | 1.203,3 km² | 7,43 km² | Guaratiba, 136,4 km² |
| Recife | 94 | 215,7 km² | 2,29 km² | Guabiraba, 46,3 km² |
| Salvador | 170 | 308,7 km² | 1,82 km² | Cassange, 15,3 km² |

O polígono médio de São Paulo é **~9x maior que o de Salvador** e ~2x
maior que o do Rio de Janeiro (que também tem distritos periféricos
grandes, mas ainda assim menores em média). Marsilac e Parelheiros
(151,7 km²) sozinhos são maiores que municípios inteiros do Nordeste.
Isso confirma visualmente o que os dados já indicavam: distritos
periféricos de São Paulo aparecem no mapa como blocos enormes cobrindo
uma população que, em qualquer outra capital coberta, estaria
subdividida em dezenas de bairros menores.

**Causa identificada: A + B juntas, mesma raiz.** Poucos bairros (A) E
polígonos grandes (B) são consequência direta de uma única causa: o
Censo 2022 do IBGE não tem `NM_BAIRRO`/`NM_SUBDIST` preenchido pra São
Paulo/Campinas/Sorocaba, forçando o fallback pro nível de distrito.

**Causa C descartada.** Inspecionei `components/map/NeighborhoodLayer.tsx`
— não há nenhuma lógica de zoom, filtro por área ou simplificação que
esconda polígonos pequenos. Todo polígono no banco é renderizado,
independente de zoom ou tamanho. O problema é 100% dado de origem, não
apresentação.

## Por que o Nordeste "parece" mais granular

Não é que o Censo tenha mais `NM_BAIRRO` preenchido no Nordeste em
termos absolutos — olhando a tabela do resumo executivo, BA (34,8%),
MA (41,4%) e PB (46,6%) têm proporção de bairro real BEM menor que RJ
(83,3%) ou SC (79,4%). A percepção de "mais granular" no Nordeste
provavelmente vem de outro fator: Salvador, Recife e Natal foram
processadas pelo **pipeline original por-cidade** (não o pipeline
estadual usado pra tudo mais), com tratamento individual e validação
manual desde o início do projeto — desde a primeira sessão inclusive.
As demais capitais do Nordeste (Fortaleza, Maceió, Aracaju, João
Pessoa, São Luís, Teresina) têm cobertura parcial/mínima, exatamente
como registrado no README. A "sensação" de granularidade do Nordeste é
puxada por essas 3 capitais historicamente prioritárias, não por uma
característica regional do Censo do IBGE.

## Fontes alternativas — só São Paulo precisa

Como só São Paulo (capital), Campinas e Sorocaba têm essa lacuna — as
outras 6 capitais do pedido original (Rio de Janeiro, Belo Horizonte,
Curitiba, Porto Alegre, Florianópolis, Vitória) já têm bairro real via
IBGE, sem necessidade de fonte alternativa — pesquisei só pra São
Paulo, o caso de maior impacto:

**GeoSampa / dados.prefeitura.sp.gov.br** (portal oficial da prefeitura):
**só publica distritos** como dado aberto, mesma granularidade que já
temos via IBGE. Não existe um dataset municipal oficial de "bairros"
informais em formato aberto — confirmei buscando diretamente no
catálogo (`dados.prefeitura.sp.gov.br/dataset?tags=bairros`), único
resultado é o mesmo dataset de distritos.

Existe um espelho pronto pra download direto (GeoJSON) em
`github.com/codigourbano/distritos-sp` — mas é a mesma informação de
distrito, sem ganho de granularidade sobre o que já está no banco.

**Conclusão importante:** para São Paulo, **96 distritos pode ser o
teto real do dado oficial disponível**, não uma lacuna de pesquisa.
Bairros informais de São Paulo (ex: Vila Madalena, Higienópolis,
Jardins) não têm limite oficial e reconhecido por nenhum órgão público
— existem iniciativas de crowdsourcing (ex: "Projeto Bairros" do
Forest-GIS, mencionado achado ao pesquisar Campinas) que tentam
consolidar isso, mas são dado não-oficial, sem a mesma
confiabilidade/atualização das fontes usadas em todo o resto do
projeto (IBGE, ANA, prefeituras com portal GIS formal). Não pesquisei
a fundo Campinas/Sorocaba especificamente (fora do escopo — o pedido
focou nas capitais listadas), mas a mesma limitação estrutural
provavelmente se aplica.

## Recomendação

### Antes do deploy
Nenhuma ação bloqueadora — o problema visual em São Paulo é real, mas
não é um bug corrigível rapidamente: é o teto do dado público
disponível pra essa cidade específica. As outras 15 estados/capitais
não têm esse problema.

### Pode ficar para depois
1. **Se quiser granularidade melhor pra São Paulo**, avaliar
   explicitamente usar uma fonte não-oficial/crowdsourced (ex: Projeto
   Bairros do Forest-GIS) — mas isso muda o padrão de proveniência de
   dado do projeto (até agora, 100% fontes oficiais), vale decisão
   consciente, não uma correção técnica simples.
2. Investigar Campinas e Sorocaba especificamente (fora do escopo
   deste diagnóstico) pra confirmar se têm a mesma lacuna e se o
   próprio site da prefeitura de cada uma publica algo melhor que
   distrito.
3. Considerar documentar no frontend (ex: um aviso "dado por distrito,
   não por bairro" pra usuários em São Paulo/Campinas/Sorocaba) — mais
   barato que buscar uma fonte de dado melhor, e resolve a confusão do
   usuário sem mudar a fonte.
