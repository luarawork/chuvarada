# Diagnóstico — Saneamento (Censo 2022) e Vulnerabilidade Socioambiental (IVS/IPEA)

Diagnóstico apenas — nada foi integrado ao modelo de risco. Este relatório cobre o que foi encontrado, baixado, cruzado com os casos já validados, e a recomendação resultante.

## Fontes encontradas

- **Censo 2022 (IBGE)** — o produto certo não é "Agregados por Setores Censitários" na granularidade de setor, e sim o subproduto **"Agregados por Bairro"** dentro dele (`Agregados_por_Setores_Censitarios/Agregados_por_Bairro_csv/`). Essa granularidade é a mesma que o Chuvarada já usa (`neighborhoods.name`), o que evita ter que agregar de setor censitário pra bairro manualmente.
- **IVS (IPEA)** — não tem download direto na página institucional (`ipea.gov.br/atlasivs` retorna 404; `dados.gov.br` e o próprio `ivs.ipea.gov.br` são SPAs que não expõem o link em HTML estático). O caminho real é `ivs.ipea.gov.br` → **Repositório → Base de Dados e Shapefiles → "IVS Municipal — Base Completa"**.

## Dados baixados

| Arquivo | Fonte | Tamanho | Cobertura |
|---|---|---|---|
| `basico_BR.zip` + `domicilio{1,2,3}_BR.zip` + dicionário | Censo 2022 IBGE, Agregados por Bairro | ~10 MB comprimido (~64 MB extraído) | **895 municípios** — só os que têm bairro oficial definido pelo IBGE |
| `basecompletamunicipal.zip` (→ `atlasivs_dadosbrutos_pt_v2.xlsx`) + dicionário | IVS/IPEA | 201 MB comprimido / 210 MB extraído | 5.570 municípios, mas só anos **2000 e 2010** no nível município (confirmado escaneando as ~340.786 linhas do arquivo — nenhuma linha de nível município passa de 2010) |

Ambos os downloads ficam em `dados-brutos/censo2022_bairro/` e `dados-brutos/ivs/` (não versionados, ~460 MB no total — vale apagar se não for usar de novo).

### Achado sobre a cobertura do Censo por bairro

Só **895 dos 5.570 municípios brasileiros** têm bairro oficial reconhecido pelo IBGE nesse produto — os demais (a maioria dos municípios `data_level=minimal` do Chuvarada) só têm o dado no nível município inteiro (`Agregados_por_Municipio`), não por bairro. Ou seja: mesmo se a integração fosse aprovada, ela nunca cobriria o Brasil inteiro na granularidade de bairro — só as cidades maiores.

### Achado sobre a granularidade e atualização do IVS

**Confirmado: município, não setor/bairro.** Também existe o recorte de UDH (Unidade de Desenvolvimento Humano), mas só dentro de Regiões Metropolitanas específicas — não é um recorte nacional nem corresponde a bairro do IBGE.

Mais importante: o IVS está **travado no Censo 2010**. Achei, dentro do próprio repositório de "Material Técnico Suplementar" do IVS, uma Nota Técnica de **2025** (`NT_Dirur_54`) chamada *"Ajustes metodológicos para atualização do Índice de Vulnerabilidade Social (IVS) com base na PNAD contínua 2023 e compatibilização com o Censo Demográfico 2022"* e um Boletim de 2025 chamado *"Trabalhos preparatórios para atualização do IVS a partir do Censo Demográfico 2022: primeiros passos"* — ou seja, a própria IPEA confirma que a atualização pro Censo 2022 **ainda está em preparação**, não foi publicada. Usar o IVS hoje é usar um retrato de 2010 (dado de 16 anos atrás).

### Cruzamento com os bairros do Chuvarada — viável, mas parcial

`neighborhoods` não guarda nenhum código IBGE de bairro (`CD_BAIRRO`) — testei casamento por nome normalizado (bairro + cidade) contra os 275 bairros do Chuvarada nas 4 cidades-caso (Natal, Recife, Porto Alegre, Santa Maria): **265/275 bateram exatamente (96,4%)**. As 10 falhas são todas em Santa Maria/RS — distritos rurais que o Chuvarada usa como "bairro" (Arroio do Só, Boca do Monte, Pains, Palma...) e que o Censo não reconhece como bairro urbano oficial. Cruzamento por nome é viável como primeira aproximação, mas não é 100% e precisaria de um fallback geográfico pros casos que não baterem.

---

## Correlação com os casos já validados

| Município | IVS (2010) | IVS Infra. Urbana | % s/ água+esgoto adequados (IVS, indicador oficial) | % s/ esgoto por rede/fossa ligada (Censo 2022, calculado agora) | Modelo acertou? |
|---|---|---|---|---|---|
| Natal/RN | 0,292 | 0,287 | 0,98% | 54,7% | ✅ Acertou (13/13 bairros confirmados) |
| Recife/PE | 0,319 | 0,308 | 2,52% | 32,2% | ✅ Acertou (referência histórica) |
| Porto Alegre/RS | 0,249 | 0,322 | 0,38% | 6,7% | ✅ Acertou (padrão frontal, consistente) |
| **Santa Maria/RS** | **0,185** | **0,107** | **0,64%** | 18,4% | ❌ **Subestimou** |

### Hipótese confirmada ou refutada?

**Refutada pela amostra disponível.** A hipótese era "IVS alto/saneamento ruim → modelo subestima mais". O único caso real de subestimação (Santa Maria/RS) tem o **menor** IVS dos 4 (0,185 — faixa "baixa vulnerabilidade" na escala do próprio IVS) e a **segunda melhor** taxa de saneamento adequado do grupo. Já Natal, que o modelo acertou perfeitamente, tem de longe o pior índice bruto de esgoto por rede/fossa (54,7% sem isso) entre os 4. Com n=4 (e só 1 caso de erro) não dá pra tirar conclusão estatística nenhuma, mas os números que existem apontam na direção **oposta** à hipótese, não a favor dela.

### Achado colateral — a mesma cidade, dois números de saneamento bem diferentes

Reparei que `t_sem_agua_esgoto` do IVS (2010) e o percentual que calculei agora a partir do Censo 2022 medem coisas diferentes o bastante pra dar resultados que parecem contraditórios pra mesma cidade: em Natal, o IVS diz 0,98% "inadequado" porque exige água **E** esgoto simultaneamente ruins (e a água é quase universal lá, 98,6%, o que já derruba a métrica combinada pra perto de zero); meu cálculo isolado de esgoto (sem considerar água) dá 54,7%. Nenhum dos dois está errado — são definições diferentes do que conta como "inadequado". Isso é um alerta prático: qualquer `saneamento_score` que o Chuvarada viesse a criar precisa fixar uma definição exata (E vs OU, quais categorias contam como adequadas) antes de virar peso de modelo, porque o número final pode variar em ordens de grandeza dependendo dessa escolha.

---

## Avaliação de viabilidade de integração

### Achado decisivo — o IVS já embute saneamento

O próprio dicionário de metodologia do IVS confirma que `ivs_infraestrutura_urbana` (1 dos 3 subíndices que compõem o IVS, peso igual aos outros 2) já é calculado com:
- 30% do peso: % sem coleta de lixo
- 30% do peso: % com água e esgoto inadequados
- 40% do peso: % vulnerável à pobreza + mais de 1h até o trabalho

Ou seja, **saneamento já está dentro do IVS**. Se o Chuvarada usasse os dois — saneamento bruto do Censo E o IVS — como pesos separados no mesmo modelo, estaria contando o mesmo sinal social duas vezes.

### Granularidade incompatível com a cobertura nacional do Chuvarada

- IVS: município (5.570, mas travado em 2010).
- Saneamento do Censo por bairro: só 895 municípios.
- A maioria dos municípios `data_level=minimal`/`partial` do Chuvarada não teria nenhum dos dois dados na granularidade de bairro.

### Saneamento inadequado é mais sobre alagamento urbano por chuva intensa do que sobre inundação fluvial

Distinção que já está documentada nas limitações conhecidas do Chuvarada (Amazônia) — vale reforçar aqui: os indicadores de saneamento (esgoto a céu aberto, bueiro entupido) modelam bem risco de poça/alagamento por escoamento, mas dizem pouco sobre transbordamento de rio (o caso de Santa Maria foi justamente isso — rio transbordando de verdade, não escoamento urbano por falta de saneamento).

---

## Recomendação

**Não integrar ao modelo agora — nem como peso, nem como badge visual, ainda.** Motivos, em ordem de peso:

1. A hipótese que motivou essa investigação (vulnerabilidade social explica subestimação) não se sustenta nos únicos dados que temos pra testá-la — arriscar calibrar em cima de 1 caso é ruído, não sinal.
2. IVS congelado em 2010 (atualização pro Censo 2022 "em preparação" segundo o próprio IPEA, não publicada) — misturar um retrato social de 16 anos atrás com um modelo de risco recalculado a cada hora é uma inconsistência de frescor de dado que merece ser evitada.
3. Nenhuma das duas fontes cobre o Brasil inteiro na granularidade que o Chuvarada precisaria (bairro) — cobertura de 895/5.570 municípios (saneamento) ou município inteiro sem bairro (IVS).
4. Risco real de dupla contagem — o IVS já pondera saneamento e coleta de lixo dentro de si mesmo.

Se a ideia for retomada no futuro, o caminho mais seguro é: (a) esperar a atualização do IVS pro Censo 2022 (o próprio IPEA já sinalizou que está vindo), (b) acumular mais casos de subestimação validados antes de testar a hipótese de novo com uma amostra que sustente alguma conclusão, e (c) se decidir integrar, preferir o formato de badge informativo (não recalibração de score) restrito às cidades onde o dado de fato existe na granularidade certa, com a fonte e o ano do dado visíveis na UI.
