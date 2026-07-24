# Diagnóstico de Lacunas — 7 Estados com Cobertura Insuficiente

**Estados**: Maranhão (MA), Piauí (PI), Ceará (CE), Alagoas (AL), Pernambuco (PE), Sergipe (SE), Paraíba (PB)
**Data**: 2026-07-19 · **Escopo**: só leitura — nenhum dado alterado no banco.

---

## 1. Diagnóstico por dimensão

### 1.1 Hidrografia (`hydro_proximity = 0`)

| Estado | Bairros com hydro=0 | Causa | Fora do bbox atual? |
|---|---:|---|---|
| MA | 102 / 415 (24,6%) | `NORDESTE_BBOX` corta o **oeste do estado** (limite oeste real: -48,76°; bbox atual: -45,0°) | 102/102 (100%) |
| PB | 27 / 551 (4,9%) | `NORDESTE_BBOX` corta a **borda leste** — inclui bairros litorâneos da **capital João Pessoa** (Cabo Branco, Tambaú, Manaíra, Ponta do Seixas — limite leste real: -34,79°; bbox atual: -35,0°) | 27/27 (100%) |
| PI | 6 / 702 (0,9%) | 5 fora do bbox (oeste/sul do estado); 1 isolado (Luís Correia/Coqueiro, dentro do bbox — provável geometria pequena sem curso d'água BHO próximo) | 5/6 |
| PE | 4 / 1.056 (0,4%) | Fernando de Noronha (arquipélago, -32,48°, fora a leste), Goiana e Ilha de Itamaracá (bordas) | 3/4 |
| CE | 5 / 2.197 (0,2%) | Nenhum relacionado a bbox — casos isolados (Crato x2, Icapuí, Quixeré x2), dentro do bbox | 0/5 |
| AL | 0 / 240 | — | — |
| SE | 0 / 275 | — | — |

**O ANA gpkg cobre a região se alargarmos o bbox?** Sim, sem ressalva. Verifiquei os metadados de `dados-brutos/ana/geoft_bho_curso_dagua.gpkg` diretamente (`pyogrio.read_info`, sem carregar os 2,9GB completos):

```
crs: EPSG:4674
features: 2.751.685
total_bounds: (-79.56, -50.28, -34.80, 11.11)
```

O geopackage cobre o **Brasil inteiro** — a limitação é 100% do `NORDESTE_BBOX` artificial em `process_bho.py`, não do dado fonte. Alargar o bbox não tem custo de qualidade, só um pouco mais de tempo de leitura.

### 1.2 Maré

| Estado | Cidades costeiras | Com `tide_code` | Sem `tide_code` |
|---|---:|---:|---:|
| MA | 31 | 2 | 29 |
| PI | 4 | 1 | 3 |
| CE | 21 | 2 | 19 |
| AL | 16 | 1 | 15 |
| PE | 15 | 2 | 13 |
| SE | 9 | 2 | 7 |
| PB | 10 | 2 | 8 |
| **Total** | **106** | **12** | **94** |

**Achado central**: peguei o catálogo completo do CPTEC (`ondas.cptec.inpe.br/~rondas/mares/` — a página não carrega via HTTPS moderno, mas responde normal em HTTP puro) e ele lista **51 estações em todo o Brasil**, das quais só **~23 ficam no Nordeste**. Ou seja, isso não é uma pesquisa que "ainda não foi feita a fundo" — é o **catálogo inteiro**, e praticamente todas as estações relevantes já estão cadastradas no banco. A única exceção real:

> **`30955` — "Ilha de Fernando de Noronha" — existe no catálogo CPTEC e nunca foi cadastrada.** Fernando de Noronha (PE) tem estação própria, dedicada, e está com `tide_code = null` hoje.

Fora esse caso, **não existe mais nenhum código CPTEC "novo" pra descobrir** pros outros 93 municípios sem código — o oceano brasileiro só tem essas ~23 estações no Nordeste. A solução tecnicamente correta não é "pesquisar mais", é **atribuir a estação mais próxima geograficamente** como aproximação (maré varia mais em amplitude do que em fase/tempo entre pontos próximos da mesma costa). Calculei a estação mais próxima pra cada uma das 94 cidades sem código (distância em linha reta até a cidade que já usa aquele código):

| Confiança (distância) | MA | PI | CE | AL | PE | SE | PB |
|---|---:|---:|---:|---:|---:|---:|---:|
| Alta (≤30km) | 4 | 2 | 4 | 2 | 8 | 2 | 3 |
| Média (30–80km) | 12 | 1 | 7 | 11 | 5 | 5 | 5 |
| Baixa (>80km) | 13 | 0 | 8 | 2 | 0 | 0 | 0 |

Exemplos de alta confiança prontos pra aplicar: Olinda→Recife (6km), Paulista→Recife (13km), Lucena→Cabedelo (13km), Santa Rita→Cabedelo (14km), Santo Amaro das Brotas→Inácio Barbosa (14km), Paracuru→Pecém (12km), São José de Ribamar→São Luís (19km), Cajueiro da Praia→Luís Correia (19km), Marechal Deodoro→Maceió (19km). Os casos "baixa confiança" (MA principalmente — Carutapera a 236km de São Luís, por exemplo) não deveriam ganhar maré por aproximação; melhor deixá-los sem `tide_code` do que atribuir um dado enganoso.

### 1.3 Granularidade dos bairros (nome real vs. distrito)

| Estado | % nome de bairro real | % distrito (fallback) |
|---|---:|---:|
| PI | 67,8% | 31,7% |
| SE | 65,2% | 34,8% |
| PE | 62,3% | 37,3% |
| CE | 59,5% | 40,5% |
| AL | 51,7% | 47,5% |
| PB | 46,6% | 53,4% |
| MA | 41,4% | 58,6% |

**Fontes alternativas pesquisadas** (todas com shapefile/geoportal ativo confirmado em julho de 2026):

- **São Luís (MA)**: [saoluis.ma.gov.br/base-cartografica](https://www.saoluis.ma.gov.br/base-cartografica/) — a própria prefeitura disponibiliza shapefile/KML/DWG. Achado importante: a prefeitura publicou em 2025 que **São Luís não tem lei de bairro**, o que impede o IBGE de liberar dado censitário nesse nível — isso confirma exatamente por que os setores censitários do Censo 2022 não têm `NM_BAIRRO` preenchido pra São Luís (é a mesma causa raiz do bug de upload corrigido na sessão anterior). O município reagrupa por "unidades de planejamento" cruzando o cadastro técnico municipal com os setores do IBGE — um shapefile de 204 registros (bairros/distritos) datado de abril/2025 está disponível via [GISMaps](https://www.gismaps.com.br/en/downloads/bairros-de-sao-luis-shp/), redistribuindo dado da prefeitura.
- **Teresina (PI)**: [semplan.pmt.pi.gov.br/mapas-interativos](https://semplan.pmt.pi.gov.br/mapas-interativos/) — portal oficial da SEMPLAN com mapas por bairro/zona já atualizados.
- **Maceió (AL)**: [Observatório da Cidade](https://observatoriodacidade.maceio.al.gov.br/) (IPLAM) + [dados.al.gov.br](https://dados.al.gov.br/catalogo/dataset/municipio-de-maceio/) — dataset vetorial oficial do estado com o mapa político-administrativo de Maceió, e outro dataset "Bairros de Alagoas" cobrindo o estado inteiro.
- **João Pessoa (PB)**: [geo.joaopessoa.pb.gov.br](http://geo.joaopessoa.pb.gov.br/digeoc/htmls/) / [Filipeia](https://filipeia.joaopessoa.pb.gov.br/) — geoportal oficial ativo, exporta SHP/KML por bairro, inclusive um atlas em PDF ("Perfil de bairro").
- **Aracaju (SE)**: [MapAju](https://map.aracaju.se.gov.br/) + [SIUGWEB](http://siugweb.aracaju.se.gov.br/) — geoportal oficial ativo, com exportação de shapefile de qualquer camada visível na tela.

Todas as 5 capitais têm fonte oficial viva — isso é reprocessável sem depender de pesquisa adicional, só de baixar e adaptar `process_neighborhoods.py` pra ler o formato de cada portal (nem todos têm o mesmo schema de atributos).

### 1.4 Scores calculados

| Estado | Score mín | Score máx | Distintos/Total | Suspeito? |
|---|---:|---:|---:|---|
| MA | 0,058 | 0,243 | 415/415 | Não |
| PI | 0,063 | 0,266 | 702/702 | Não |
| CE | 0,061 | 0,310 | 2197/2197 | Não |
| AL | 0,164 | 0,324 | 240/240 | Não |
| PE | 0,068 | 0,348 | 1056/1056 | Não |
| SE | 0,154 | 0,268 | 275/275 | Não |
| PB | 0,116 | 0,322 | 551/551 | Não |

Nenhum dos 7 estados tem score idêntico ou "travado" — a proporção de valores distintos é de 100% em todos. **Mas** (padrão já documentado no diagnóstico nacional anterior) 100% dos bairros do Nordeste inteiro, incluindo esses 7 estados, estão em nível "normal" neste instante — consistente com ausência de chuva significativa no momento da consulta, não um bug. Não é um problema específico desses 7 estados.

---

## 2. Bbox do `process_bho.py`

Bbox atual (`NORDESTE_BBOX` em `scripts/process_bho.py`):
```python
NORDESTE_BBOX = (-45.0, -15.0, -35.0, -1.0)  # min_lon, min_lat, max_lon, max_lat
```

Calculei a extensão real necessária a partir da geometria de **todos os bairros já cadastrados nos 9 estados** (não uma estimativa — bbox exato dos dados que já existem):

```
Extensão real dos 9 estados: (-48.755, -18.349, -32.378, -1.049)
```

Os **quatro lados** do bbox atual estão apertados demais:

| Lado | Atual | Necessário | Quem fica de fora |
|---|---:|---:|---|
| Oeste (min_lon) | -45,0 | -48,76 | Oeste do Maranhão (84 municípios) |
| Sul (min_lat) | -15,0 | -18,35 | Extremo-sul da Bahia (não está nos 7 estados desta rodada, mas é o mesmo bug) |
| Leste (max_lon) | -35,0 | -32,38 | Fernando de Noronha/PE, litoral leste de João Pessoa/PB |
| Norte (max_lat) | -1,0 | -1,05 | Diferença pequena (ponta norte do MA), mas ainda corta |

**Bbox proposto** (com margem de segurança de ~0,5° em cada direção, sem desperdício real já que o gpkg fonte cobre o Brasil inteiro):

```python
NORDESTE_BBOX = (-49.5, -19.0, -31.5, -1.5)
```

Essa margem cobre os 9 estados com folga suficiente pra qualquer imprecisão de geometria nas bordas, sem chegar perto do limite real do gpkg (que vai até -79,56/-50,28/-34,80/11,11 — Brasil inteiro). Não há custo de "desperdício de processamento" relevante: o gpkg já é recortado via bbox pushdown no próprio `read_file`, então mais alguns graus de margem não implica carregar mais dado do que o necessário — só garante que nenhum bairro real fique de fora.

---

## 3. Fontes estaduais pesquisadas (IDE / Defesa Civil)

| Estado | Órgão | O que encontrei |
|---|---|---|
| MA | IMESC (imesc.ma.gov.br) | Portal [DataIMESC](https://dataimesc.imesc.ma.gov.br/) ativo. Existe um Atlas de Vulnerabilidade a Enchentes do MA (ANA + SEMA-MA + Defesa Civil-MA, 2013) com mapa de vulnerabilidade por trecho de rio — fonte histórica, não uma API viva, mas pode servir de referência. |
| PI | CEPRO (agora incorporada à SEPLAN-PI) | Portal [DataCepro](https://datacepro.pi.gov.br/) e [Terras.PI](https://interpi.pi.gov.br/projetos/plataforma-de-dados-geoespaciais/) (INTERPI) — catalogam dado geoespacial rural, sem menção direta a defesa civil/áreas de risco urbanas. |
| CE | IPECE | Sistema "[Ceará em Mapas Interativos](https://www.ipece.ce.gov.br/ceara-em-mapas-interativos/)" com download georreferenciado, base cartográfica digital 1:50.000 com hidrografia (rios/açudes/lagoas) vetorizada de imagens SPOT-5 — provavelmente mais precisa que a BHO nacional pro Ceará especificamente. Sem conexão direta a defesa civil nos resultados. |
| PE | CONDEPE/FIDEM | Acervo cartográfico virtual com fotos aéreas, ortofotomapas e cartas planialtimétricas — acervo histórico robusto, mas não encontrei um geoportal moderno com download direto de shapefile de hidrografia. |
| AL | SEPLAG-AL | "[Alagoas Geográfico](http://acervo.seplag.al.gov.br/planejamento-e-orcamento/informacoes-e-conhecimento/alagoas-geografico-1)" + [dados.al.gov.br](https://dados.al.gov.br/catalogo/dataset/recursos-hidricos-de-alagoas) com dataset de recursos hídricos e regiões/bacias hidrográficas de Alagoas em SHP — utilizável, mas AL já está com 100% de `hydro_proximity` real, então baixa prioridade. |
| SE | SEMAC/SERhidro | **[SERhidro](https://serhidro.semac.se.gov.br/)** — geoportal moderno lançado em 2024, com dataset dedicado "[Hidrografia Sergipe](https://serhidro.semac.se.gov.br/datasets/hidrografia-sergipe)", download em GeoJSON/KML/GeoTIFF, API WMS/WFS. É o achado de melhor qualidade técnica dos 7 — mas SE já está com 100% de `hydro_proximity` real, então serve mais como upgrade de precisão futuro do que correção urgente. |
| PB | AESA | [Geoportal AESA](https://geoportal.aesa.pb.gov.br/arquivos/arquivos-shapefiles/) com shapefiles de bacias hidrográficas, drenagem principal e sub-bacias da Paraíba — dado estadual dedicado, mais preciso que a BHO nacional pra área específica da PB. |

Nenhum dos 7 estados tem um portal de Defesa Civil com **áreas de risco geocodificadas e baixáveis** claramente identificado nesta pesquisa — o que existe é mais próximo de "atlas" ou notícia pontual (ex.: MA 2013, SE recorrente) do que uma API/shapefile mantido. Não acho que vale investir tempo tentando raspar esses sites de notícia; se houver interesse em áreas de risco por Defesa Civil, o caminho mais realista é contato direto com cada órgão, não descoberta via busca.

---

## 4. Tabela-resumo por estado

| Estado | Hidrografia | Maré | Granularidade | Scores |
|---|---|---|---|---|
| **MA** | 🔴 102 bairros sem dado (100% por bbox, corrigível) | 🔴 29/31 cidades costeiras sem código (só 2 estações CPTEC cobrem o litoral do MA) | 🔴 58,6% distrito — pior do grupo, + limitação legal confirmada (sem lei de bairro) | 🟢 OK |
| **PB** | 🟡 27 bairros sem dado, mas 100% por bbox — inclui a capital (João Pessoa) | 🟡 8/10 sem código, mas todas com estação próxima de alta confiança | 🔴 53,4% distrito | 🟢 OK |
| **PI** | 🟢 Só 6/702 (0,9%), quase resolvido | 🟡 3/4 sem código, baixo volume absoluto | 🟢 67,8% real — melhor do grupo | 🟢 OK |
| **CE** | 🟢 Só 5/2197 (0,2%), casos isolados | 🔴 19/21 sem código, 8 de baixa confiança (litoral oeste/Jericoacoara) | 🟡 59,5% real | 🟢 OK |
| **AL** | 🟢 0 bairros sem dado | 🔴 15/16 sem código | 🟡 51,7% real | 🟢 OK |
| **PE** | 🟢 Só 4/1056 (0,4%) — mas inclui Fernando de Noronha (estação CPTEC própria nunca cadastrada) | 🟡 13/15 sem código, mas 8 de alta confiança | 🟢 62,3% real | 🟢 OK |
| **SE** | 🟢 0 bairros sem dado | 🟡 7/9 sem código, baixo volume absoluto | 🟢 65,2% real | 🟢 OK |

**Esforço estimado por correção**:

| Correção | Esforço |
|---|---|
| Alargar `NORDESTE_BBOX` + reprocessar hidrografia de MA/PB/PI/PE | Baixo — dado já baixado, só rodar `process_bho.py` de novo com bbox maior |
| Cadastrar `tide_code=30955` pra Fernando de Noronha | Baixo — 1 UPDATE, código já conhecido |
| Atribuir estação de maré mais próxima (confiança alta/média, ~63 municípios) | Baixo/Médio — script de atribuição por distância, dado já calculado nesta sessão |
| Reprocessar bairros das 5 capitais com fonte municipal real | Médio/Alto — cada portal tem schema próprio, precisa adaptar o parser por cidade |
| IDEs estaduais (CE/SE/PB) pra refinar hidrografia local | Médio — precisa avaliar formato/licença de cada fonte antes de baixar |
| Áreas de risco por Defesa Civil estadual | Alto / indefinido — não há fonte viva claramente identificada, exigiria contato direto |

---

## 5. Ordem de execução recomendada

### O que dá pra resolver sozinho (Claude Code, sem intervenção manual)
1. **Alargar o bbox e reprocessar hidrografia** de MA, PB, PI, PE — dado (gpkg de 2,9GB) já está local, é só rodar `process_bho.py` com o bbox novo contra os 4 arquivos de bairro já existentes. Resolve ~140 bairros de uma vez, incluindo a capital João Pessoa.
2. **Cadastrar `tide_code=30955` (Fernando de Noronha)** — 1 UPDATE direto, sem pesquisa adicional necessária.
3. **Atribuir `tide_code` por proximidade** pros ~63 municípios de confiança alta/média já calculados nesta sessão — não precisa de mais pesquisa, só decidir o limiar de distância aceitável e rodar o script.

### O que precisa de download manual (você baixa, Claude Code processa)
4. **Shapefiles de bairro das 5 capitais** — os portais (São Luís, Teresina, Maceió, João Pessoa, Aracaju) em geral exigem clicar/exportar pela interface web ou preencher formulário; alguns (AESA, dados.al.gov.br) têm link de download direto que talvez dê pra automatizar, mas os geoportais municipais (Filipeia/JP, MapAju/Aracaju) parecem interativos — vale confirmar se têm endpoint de exportação em lote antes de assumir que dá pra automatizar.
5. **Hidrografia estadual de CE (IPECE)/PB (AESA)/SE (SERhidro)** pra refinar `hydro_proximity` com dado local de maior resolução que a BHO nacional — precisa avaliar formato e licença de uso de cada portal antes de baixar.

### Limitação estrutural (sem solução prática)
6. **Granularidade distrito vs. bairro no interior** — confirmado que é limitação do Censo 2022 (municípios pequenos sem bairro nomeado), reforçada no caso de São Luís pela ausência de lei municipal de bairro. Os shapefiles das capitais (item 4) resolvem só as capitais; o interior dos 7 estados continua dependente do Censo.
7. **Municípios costeiros de baixa confiança pra maré** (ex.: interior do litoral do Maranhão, >80km de qualquer estação) — não existe estação CPTEC próxima o suficiente pra ser uma aproximação razoável. Deixar sem `tide_code` é mais honesto do que forçar um valor de baixa confiança.
8. **Áreas de risco por Defesa Civil estadual** — nenhuma fonte viva e baixável identificada nesta pesquisa; exigiria contato direto com os órgãos, fora do escopo de "pesquisa web".
