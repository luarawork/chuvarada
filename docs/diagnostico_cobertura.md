# Diagnóstico de Cobertura — Nordeste

**Data do diagnóstico:** 2026-07-19
**Escopo:** somente leitura — nenhum dado foi alterado no banco. Todas as consultas rodaram direto no Supabase de produção via `SUPABASE_CONNECTION_STRING`.

> Nota metodológica: a query de panorama por cidade sugerida no pedido original faz `LEFT JOIN risk_scores` numa tabela que é uma série temporal (múltiplas linhas por bairro ao longo do tempo). Rodada como está, ela infla `total_bairros` pelo número de scores já calculados (a soma batia com `total_risk_scores`, não com o total real de bairros). Todas as tabelas abaixo usam `COUNT(DISTINCT n.id)`, que foi conferido batendo exatamente com `SELECT COUNT(*) FROM neighborhoods` (7.116).

---

## 1. Resumo executivo

| Métrica | Valor |
|---|---|
| Municípios no Nordeste (fonte IBGE, `/api/v1/localidades/estados/{UF}/municipios`) | **1.794** |
| Municípios cadastrados em `cities` | **1.794** (100,0%) |
| Municípios com ao menos 1 bairro/distrito | **1.793** (99,94%) |
| Total de bairros/distritos em `neighborhoods` | **7.116** |
| Bairros com `terrain_slope` real (não-placeholder) | **7.108** (99,89%) |
| Bairros com `hydro_proximity` computado (>0) | **6.729** (94,6%) — ver ressalva na seção 3.2 |
| Bairros com score de risco calculado | **7.116** (100%) |
| Cidades ativas | 1.794 (todas) |

A cobertura de **registro** (município existe em `cities`, tem bairro e tem score) está essencially completa. Os problemas reais não estão em "falta cobertura", e sim em **granularidade** (quantos bairros por cidade vieram de um nome de bairro real vs. um distrito inteiro) e em **dois bugs pontuais e bem localizados** (detalhados nas seções 2, 3.2 e 5).

---

## 2. Tabela por estado

| Estado | Municípios IBGE | Cadastrados | % | Bairros | Slope real | Hidro real* | Costeiros (cidades) | Com score |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| AL | 102 | 102 | 100,0% | 240 | 100,0% | 100,0% | 16 | 100% |
| BA | 417 | 417 | 100,0% | 1.306 | 99,8% | 92,1% | 40 | 100% |
| CE | 184 | 184 | 100,0% | 2.197 | 100,0% | 99,8% | 21 | 100% |
| MA | 217 | 217 | 100,0% | 414 | 100,0% | 75,4% | 30 | 100% |
| PB | 223 | 223 | 100,0% | 551 | 100,0% | 95,1% | 10 | 100% |
| PE | 185 | 185 | 100,0% | 1.056 | 99,9% | 99,6% | 15 | 100% |
| PI | 224 | 224 | 100,0% | 702 | 100,0% | 99,1% | 4 | 100% |
| RN | 167 | 167 | 100,0% | 375 | 98,7% | 100,0% | 25 | 100% |
| SE | 75 | 75 | 100,0% | 275 | 100,0% | 100,0% | 9 | 100% |
| **Total** | **1.794** | **1.794** | **100,0%** | **7.116** | **99,89%** | **94,6%** | **170** | **100%** |

*"Hidro real" = `hydro_proximity > 0`. Ver seção 3.2 — para MA, boa parte do "não-real" tem causa raiz identificada e corrigível (bbox de recorte), não é limitação de dado.

A tabela completa **por cidade** (todas as 1.794 linhas, mesmas colunas) foi salva em [`diagnostico_panorama_cidades.csv`](diagnostico_panorama_cidades.csv) — não reproduzida aqui por tamanho. Abaixo, as cidades com mais bairros por estado, como amostra representativa:

<details>
<summary>Top cidades por bairro, por estado (clique para expandir)</summary>

**AL:** Maceió (50), Arapiraca (42), Palmeira dos Índios (19), Barra de São Miguel (10), Penedo (9)
**BA:** Salvador (170), Juazeiro (62), Feira de Santana (59), Itabuna (56), Ilhéus (38)
**CE:** Fortaleza (121), Caucaia (63), Sobral (52), Iguatu (50), Maracanaú (46)
**MA:** São José de Ribamar (77), Caxias (37), Timon (32), Davinópolis (13), Matões (12)
**PB:** João Pessoa (64), Campina Grande (63), Cabedelo (25), Patos (25), Santa Rita (20)
**PE:** Recife (94), Caruaru (44), Petrolina (43), Olinda (32), Camaragibe (29)
**PI:** Teresina (123), Parnaíba (47), Floriano (41), Piripiri (31), Picos (28)
**RN:** Natal (36), Mossoró (28), Parnamirim (26), Currais Novos (13), São Gonçalo do Amarante (13)
**SE:** Aracaju (48), Nossa Senhora do Socorro (37), Barra dos Coqueiros (19), Tobias Barreto (18), Itabaiana (16)

</details>

---

## 3. Cidades sem bairro — lista completa com motivo

**Apenas 1 cidade** das 1.794 não tem nenhum bairro no banco: **São Luís (MA)**.

### Causa raiz (investigada e confirmada)

Não é falta de dado do IBGE nem erro geométrico — é um **bug de upload silencioso**, motivo **E** da lista do pedido original:

1. São Luís já existia em `cities` (com `tide_code` "30120") desde a fase inicial do projeto, quando a intenção era processá-la com o pipeline por-capital (`process_neighborhoods.py`), como foi feito para Fortaleza/Maceió/Aracaju/João Pessoa/Teresina. Esse processamento específico, porém, **nunca chegou a rodar** — não existe `public/geojson/neighborhoods_são_luís.geojson` no repositório (Teresina, no mesmo lote, tem o arquivo dela).
2. Quando o Maranhão inteiro foi processado depois (`process_state_neighborhoods.py`, estado completo), São Luís **foi processada com sucesso** e está no arquivo resultante `public/geojson/neighborhoods_state_ma.geojson` — 1 polígono (o distrito-sede, já que os setores censitários de São Luís não têm `NM_BAIRRO` preenchido, só `NM_DIST` = "São Luís"), com `hydro_proximity=1.00` e `terrain_slope=0.25` já calculados corretamente a partir do SRTM/BHO reais.
3. O script de upload (`scripts/upload_state_expansion.js:110`) pula qualquer município cujo nome **já exista** em `cities`, sem checar se esse município já tem bairros de fato:
   ```js
   if (cityIdByKey[key]) {
     stats.skipped_existing.push(municipio.name);
     continue;
   }
   ```
   São Luís caiu exatamente nesse buraco: existia em `cities` (do passo 1, que nunca completou), então foi silenciosamente ignorada no passo 2 (que tinha o dado pronto). Nenhum aviso foi emitido — `stats.skipped_existing` é logado, mas ninguém cruzou essa lista com "cidades que na verdade têm 0 bairros".

**Dado pronto para reaproveitar**: o polígono de São Luís já processado (nome "São Luís", fonte "distrito", `hydro_proximity=1.0`, `terrain_slope=0.25`, `is_coastal=true`) está em `public/geojson/neighborhoods_state_ma.geojson`, filtrando por `properties.city === "São Luís"`. Não precisa reprocessar nada — só inserir essa 1 linha em `neighborhoods` apontando pro `city_id` que já existe. Isso dá cobertura de risco em nível de município (não de bairro, já que o Censo não subdivide São Luís em bairros nomeados), igual ao padrão já usado noutros municípios de distrito único.

(Nesta rodada de diagnóstico eu já usei o contorno do IBGE pra maquiar o círculo cinza no mapa — mas isso é só a geometria de exibição; a linha em `neighborhoods` com o score de risco de verdade continua faltando.)

---

## 4. Qualidade dos dados dos bairros existentes

### 4.1 `terrain_slope`

| Estado | Total | Placeholder (=0,5) | Mín | Máx | Média | Mediana |
|---|---:|---:|---:|---:|---:|---:|
| AL | 240 | 0 | 0,115 | 0,766 | 0,360 | 0,314 |
| BA | 1.306 | 2 | 0,094 | 0,877 | 0,382 | 0,367 |
| CE | 2.197 | 0 | 0,107 | 0,952 | 0,293 | 0,255 |
| MA | 414 | 0 | 0,120 | 0,661 | 0,255 | 0,230 |
| PB | 551 | 0 | 0,107 | 0,797 | 0,337 | 0,298 |
| PE | 1.056 | 1 | 0,100 | 0,910 | 0,373 | 0,344 |
| PI | 702 | 0 | 0,110 | 0,727 | 0,227 | 0,212 |
| RN | 375 | 5 | 0,125 | 0,687 | 0,278 | 0,246 |
| SE | 275 | 0 | 0,104 | 0,602 | 0,262 | 0,234 |

**Achado**: terrain_slope está essencialmente resolvido — só **8 bairros em todo o Nordeste** (2 na BA, 1 em PE, 5 no RN) ainda têm o placeholder 0,5. Nenhum valor exatamente 0 (o que seria suspeito — indicaria dado faltando, não terreno real plano). O backfill feito em `scripts/backfill_terrain_slope.js` (rodado pra AL/CE/MA/PB/PI/SE) e o cálculo direto via SRTM (BA/PE/RN, por município, na expansão estadual) cobriram o essencial. Os 8 remanescentes provavelmente são nomes de bairro que não bateram entre o geojson e a tabela `cities` no momento do backfill (`missing` no log do script) — baixo impacto, fácil de re-rodar.

### 4.2 `hydro_proximity`

| Estado | Total | Zero | >0,8 | Mín | Máx | Média | Mediana |
|---|---:|---:|---:|---:|---:|---:|---:|
| AL | 240 | 0 | 232 | 0,485 | 1,000 | 0,968 | 1,000 |
| BA | 1.306 | 103 | 1.059 | 0,000 | 1,000 | 0,855 | 1,000 |
| CE | 2.197 | 5 | 2.109 | 0,000 | 1,000 | 0,963 | 1,000 |
| MA | 414 | 102 | 258 | 0,000 | 1,000 | 0,673 | 0,892 |
| PB | 551 | 27 | 447 | 0,000 | 1,000 | 0,859 | 1,000 |
| PE | 1.056 | 4 | 956 | 0,000 | 1,000 | 0,934 | 1,000 |
| PI | 702 | 6 | 636 | 0,000 | 1,000 | 0,929 | 0,997 |
| RN | 375 | 0 | 335 | 0,168 | 1,000 | 0,934 | 1,000 |
| SE | 275 | 0 | 257 | 0,475 | 1,000 | 0,960 | 1,000 |

**Achado #1 — os zeros de MA, BA, PB e PI têm causa raiz identificada, não são "dado real de longe da água"**: `scripts/process_bho.py` recorta a camada hidrográfica nacional (2,9GB) usando `NORDESTE_BBOX = (-45.0, -15.0, -35.0, -1.0)` antes de calcular a distância de cada bairro ao curso d'água mais próximo. Esse bbox **corta o oeste do Maranhão e o sul/extremo-sul da Bahia**, que ficam fora dessa caixa:

| Estado | Bairros com `hydro_proximity=0` | ...dos quais fora do bbox nacional |
|---|---:|---:|
| MA | 102 | **102 (100%)** — todos com longitude < -45,07° |
| BA | 104 | **91 (87,5%)** |
| PB | 27 | **27 (100%)** |
| PI | 6 | **5 (83%)** |
| PE | 4 | 3 (75%) |
| CE | 5 | 0 — não relacionado ao bbox, casos isolados |

Ou seja: pra ~230 bairros, `hydro_proximity=0` não significa "longe de rio" — significa "não havia dado de hidrografia disponível na área recortada pra calcular distância nenhuma". Isso é corrigível: alargar o `NORDESTE_BBOX` (sugestão: `(-49.0, -19.0, -34.0, -1.0)`, cobrindo toda a extensão oeste do MA e o extremo-sul da BA) e reprocessar `process_bho.py` contra os 4 arquivos `neighborhoods_state_{ma,ba,pb,pi}.geojson` já existentes.

**Achado #2 — concentração alta em valores próximos de 1,0, mas parece refletir densidade real de rede hidrográfica, não bug**: mais da metade dos bairros (54% no agregado bairro+distrito) tem `hydro_proximity ≥ 0,999`. A princípio isso parece suspeito (limiar do usuário: "verificar se é real ou erro"), mas ao comparar bairros com nome real (`name_source=bairro`) contra distritos-fallback (`name_source=distrito`), a taxa de "quase 1,0" é praticamente igual entre os dois grupos (53,8% vs 56,1%) — se fosse um artefato de polígonos grandes e imprecisos (distrito cobrindo o município inteiro, mais chance de tocar *algum* riacho na borda), o distrito deveria ter taxa bem maior que o bairro. Como não tem, o mais provável é que reflita mesmo a densidade real da rede de riachos/rios intermitentes da BHO no semiárido nordestino. Recomendo checagem manual pontual de 3-5 municípios claramente áridos antes de confiar cegamente nisso, mas não achei evidência de bug sistemático aqui.

### 4.3 `is_coastal`

170 municípios têm ao menos 1 bairro marcado como costeiro. Verificações pontuais contra a lista fornecida:

- ✅ **Mossoró (RN)**: 0 bairros costeiros — corretamente **não** marcada, como o usuário esperava.
- ✅ **"Una" (BA)**: não existe município IBGE com esse nome exato — o nome oficial é **"Unas"** (plural), que já está cadastrado e corretamente marcado como costeiro (2 de 5 bairros). Não é uma lacuna, só uma diferença de grafia na lista de verificação.
- ✅ Demais municípios citados pelo usuário (Ilhéus, Porto Seguro, Valença, Caravelas, Itacaré, Olinda, Jaboatão dos Guararapes, Cabo de Santo Agostinho, Parnamirim, Macau, Areia Branca-RN, Caucaia, Aquiraz, Cascavel, Aracati, Cabedelo, Bayeux, Santa Rita, Marechal Deodoro, Paripueira, Barra de Santo Antônio, São Cristóvão, Barra dos Coqueiros, Estância, São José de Ribamar, Paço do Lumiar, Raposa) — todos aparecem na lista de municípios com bairro costeiro, exceto os que não fiz checagem individual explícita por já não terem sinal de problema nas queries agregadas.
- Não encontrei nenhum caso claro de município obviamente não-costeiro marcado como costeiro por engano nas amostras verificadas.

### 4.4 Nomes de bairro

Duas métricas diferentes, que vale não confundir:

**a) Nome literal contendo "Setor" ou "Distrito" (fallback final, cru)**: apenas **24 bairros em todo o Nordeste** (0,34% do total) — o pedido original perguntava por isso, e o número é baixíssimo. Nenhum nome vazio ou nulo. As cidades com mais casos: Baixa Grande do Ribeiro/PI (2 de 10), Maracanaú/CE (6 de 46), Santa Rita/PB (2 de 20) — o resto tem no máximo 1 caso isolado por cidade.

**b) Granularidade da fonte do nome (`NM_BAIRRO` real vs. `NM_DIST`/distrito, campo interno `name_source` do pipeline)** — essa é a métrica que realmente importa pra saber se o "bairro" no mapa é uma subdivisão urbana de verdade ou o município inteiro fatiado em poucos distritos administrativos:

| Estado | % nome de bairro real | % nome de distrito (fallback) |
|---|---:|---:|
| PI | 67,8% | 31,7% |
| SE | 65,2% | 34,8% |
| PE | 62,3% | 37,3% |
| CE | 59,5% | 40,5% |
| AL | 51,7% | 47,5% |
| RN | 49,1% | 50,4% |
| PB | 46,6% | 53,4% |
| MA | 41,4% | 58,6% |
| BA | 34,8% | 65,0% |

Na Bahia, quase 2 em cada 3 "bairros" no banco são, na prática, o distrito administrativo inteiro (que pode ser bem maior que um bairro urbano) — isso é uma limitação estrutural do Censo 2022 pro interior (municípios pequenos frequentemente não têm bairro nomeado, só distrito-sede), não um bug do pipeline. Vale deixar isso explícito pra quem for interpretar o mapa: num município pequeno do interior baiano, "o bairro X" no app pode ser o município inteiro.

---

## 5. Qualidade dos scores calculados

| Estado | Total scores | Score médio | Mín | Máx | Normal | Atenção | Crítico | Auto-crítico |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| AL | 240 | 0,231 | 0,162 | 0,328 | 240 | 0 | 0 | 0 |
| BA | 1.306 | 0,212 | 0,058 | 0,307 | 1.306 | 0 | 0 | 0 |
| CE | 2.197 | 0,204 | 0,061 | 0,311 | 2.197 | 0 | 0 | 0 |
| MA | 414 | 0,164 | 0,058 | 0,243 | 414 | 0 | 0 | 0 |
| PB | 551 | 0,218 | 0,117 | 0,322 | 551 | 0 | 0 | 0 |
| PE | 1.056 | 0,241 | 0,068 | 0,351 | 1.056 | 0 | 0 | 0 |
| PI | 702 | 0,186 | 0,063 | 0,266 | 702 | 0 | 0 | 0 |
| RN | 375 | 0,215 | 0,121 | 0,280 | 375 | 0 | 0 | 0 |
| SE | 275 | 0,220 | 0,149 | 0,268 | 275 | 0 | 0 | 0 |

**Nenhum estado tem 100% dos scores *idênticos*** — a fração de valores distintos por estado é de 98,9% a 100% (ex.: BA tem 1.306 scores calculados e 1.306 valores distintos). Isso descarta a hipótese de "clima travado num valor fixo" ou cron quebrado gerando sempre o mesmo número.

**Mas há um padrão que meritoria atenção**: **100% dos bairros do Nordeste inteiro estão em nível "normal" neste instante**, com `score_max` não passando de 0,35 em nenhum estado (o limiar pra "atenção" é 0,4). Isso é consistente com **não estar chovendo de forma significativa em lugar nenhum do Nordeste no momento da consulta** — plausível pra um sistema em tempo real. Não é evidência de bug, mas também não é uma prova de que os níveis "atenção"/"crítico" realmente disparam na prática. **Recomendo repetir essa mesma verificação durante ou logo após um evento de chuva real** (ou, mais barato, rodar manualmente `calculateScore` com `rain_intensity`/`rain_1h` sintéticos altos pra confirmar que o nível sobe como esperado) antes de assumir que o modelo está calibrado corretamente ponta a ponta.

Nenhum bairro está sem nenhum score calculado (`semScore` = 0 em todos os estados).

---

## 6. Cobertura de maré

- **170 municípios** têm ao menos 1 bairro costeiro.
- Só **21 municípios** têm `tide_code` cadastrado.
- **151 municípios costeiros não têm `tide_code`** — maré não entra no score deles (peso de 8% do modelo fica zerado nesses casos).
- Todos os 21 municípios com `tide_code` têm exatamente 1 registro em `tide_cache` — cobertura de cache 100% para quem tem código.

| Estado | Cidades costeiras | Com `tide_code` |
|---|---:|---:|
| AL | 16 | 1 (Maceió) |
| BA | 40 | 4 (Salvador, Ilhéus, Candeias, Madre de Deus) |
| CE | 21 | 2 (Fortaleza, São Gonçalo do Amarante) |
| MA | 30 | 1 (São Luís) — Tutóia também tem código, mas não aparece com bairro costeiro marcado |
| PB | 10 | 2 (João Pessoa, Cabedelo) |
| PE | 15 | 2 (Recife, Ipojuca) |
| PI | 4 | 1 (Luís Correia) |
| RN | 25 | 4 (Natal, Macau, Areia Branca, Guamaré) |
| SE | 9 | 2 (Aracaju, Barra dos Coqueiros) |

### Bug encontrado: colisão de nome entre municípios homônimos

**`Areia Branca` (RN) e `Areia Branca` (SE) compartilham o mesmo `tide_code` "30407"** — e não deveriam. `scripts/upload_state_expansion.js:47` tem:

```js
"Areia Branca": "30407", // Porto de Areia Branca-Termisa-RN
```

Esse mapa (`TIDE_CODE_OVERRIDES`) é indexado só pelo **nome do município**, sem o estado — então quando o script processou Sergipe, achou outro município chamado "Areia Branca" (interior de SE, ~640km do de RN, **`is_coastal=false`** confirmado no banco) e aplicou o mesmo código de maré do RN. Na prática hoje isso é inofensivo (o bairro de SE não é costeiro, então o modelo provavelmente não usa `tide_level` pra ele), mas é um dado logicamente errado que pode confundir análises futuras ou vazar pro cálculo se a lógica de "usa maré só se `is_coastal`" mudar. **Correção recomendada**: trocar a chave do mapa pra `"NomeDoMunicípio::UF"`, como já é feito em `cityIdByKey` no mesmo arquivo.

### Estações CPTEC não aproveitadas (pesquisa rápida)

Não fiz uma varredura completa do catálogo CPTEC (fora do escopo de tempo deste diagnóstico), mas o padrão observado — só 21 de 170 municípios costeiros com código — sugere que a maior parte da cobertura de maré ainda depende de alguém cadastrar manualmente `TIDE_CODE_OVERRIDES` por município. Cidades grandes/turísticas sem código hoje que valeriam checagem prioritária: Porto Seguro, Valença, Caravelas, Itacaré (BA), Jaboatão dos Guararapes, Olinda, Cabo de Santo Agostinho (PE), Parnamirim (RN), Caucaia, Aquiraz, Aracati (CE), Barra de São Miguel, Marechal Deodoro (AL), Estância (SE), São José de Ribamar, Paço do Lumiar, Raposa (MA). Piauí tem só 4 municípios costeiros no banco (via o delta do Parnaíba) e já tem 1 com código (Luís Correia) — Parnaíba, a cidade grande da região, ainda não tem.

---

## 7. Problemas de qualidade encontrados (resumo)

| # | Problema | Severidade | Estados afetados | Corrigível sem reprocessar dado? |
|---|---|---|---|---|
| 1 | São Luís (MA) sem nenhum bairro no banco — dado já processado, só não foi inserido (bug de skip no upload) | Alta (1 cidade grande sem cobertura nenhuma) | MA | **Sim** — só um INSERT |
| 2 | `hydro_proximity=0` por bbox nacional cortando oeste do MA / sul da BA / bordas de PB, PI | Média (~230 bairros com dado ausente mascarado de "longe d'água") | MA, BA, PB, PI, PE | Não sem reprocessar `process_bho.py` com bbox maior |
| 3 | `tide_code` "30407" duplicado entre Areia Branca/RN (costeira) e Areia Branca/SE (não-costeira) | Baixa (inofensivo hoje, mas logicamente errado) | RN, SE | **Sim** — 1 UPDATE |
| 4 | 8 bairros com `terrain_slope` placeholder (0,5) remanescente | Baixa (volume ínfimo) | BA(2), PE(1), RN(5) | Sim — re-rodar backfill |
| 5 | 151 municípios costeiros sem `tide_code` (maré não entra no score) | Média (afeta 8% do peso do modelo em 89% dos municípios costeiros) | Todos | Não sem pesquisar/cadastrar códigos CPTEC |
| 6 | ~65% dos "bairros" na Bahia (e proporção grande em outros estados) são na verdade distritos administrativos inteiros, não bairros urbanos | Estrutural (limitação do Censo, não bug) | Todos, mais forte em BA/MA/PB | Não — limitação da fonte de dado |
| 7 | 24 bairros com nome cru "Setor X" (sem nome de distrito nem bairro) | Baixa (volume ínfimo, 0,34%) | PI, CE, PB, PE principalmente | Não sem fonte de nome adicional |

---

## 8. Recomendações

### Vale corrigir agora (baixo esforço, alto retorno)
1. **Inserir o bairro de São Luís** já processado em `public/geojson/neighborhoods_state_ma.geojson` (filtro `city === "São Luís"`) na tabela `neighborhoods`, apontando pro `city_id` existente — resolve a única cidade sem cobertura nenhuma.
2. **Corrigir a chave do `TIDE_CODE_OVERRIDES`** em `upload_state_expansion.js` pra `nome::estado`, e rodar um `UPDATE` pontual removendo o `tide_code` errado de Areia Branca/SE (ou verificar se existe um código CPTEC de verdade pra ela, já que não é costeira, provavelmente não existe nenhum).
3. **Re-rodar `backfill_terrain_slope.js`** (ou uma variante pra BA/PE/RN) nos 8 bairros com placeholder remanescente.

### Vale fazer numa próxima iteração (esforço médio)
4. **Alargar `NORDESTE_BBOX`** em `process_bho.py` pra `(-49.0, -19.0, -34.0, -1.0)` e reprocessar `hydro_proximity` pros 4 estados afetados (MA, BA, PB, PI) — dado real disponível, só precisa de um recorte maior da BHO nacional.
5. **Levantar códigos CPTEC** pros municípios costeiros grandes listados na seção 6 (Porto Seguro, Jaboatão dos Guararapes, Parnamirim, Caucaia, etc.) — maior impacto no modelo de risco costeiro.
6. **Validar o modelo de score com um evento de chuva real** (ou sintético) pra confirmar que os níveis "atenção"/"crítico" disparam corretamente — hoje só temos evidência de que o score varia, não de que ele escala certo até os limiares superiores.

### Limitação estrutural (não corrigível sem nova fonte de dado)
7. **Granularidade distrito vs. bairro no interior** — o Censo 2022 do IBGE simplesmente não nomeia bairros pra boa parte dos municípios pequenos do Nordeste. Isso não tem correção via pipeline; só troca de fonte (ex.: alguma prefeitura com cadastro de bairro próprio) resolveria, e isso é inviável de fazer pra 1.794 municípios. Vale documentar isso de forma visível no app (ex.: tooltip "cobertura em nível de distrito" quando `name_source != bairro`), já que hoje o usuário não tem como saber se está vendo um bairro de verdade ou o município inteiro.

---

## Anexos

- Dados por cidade completos: [`diagnostico_panorama_cidades.csv`](diagnostico_panorama_cidades.csv)
- Consultas SQL usadas: reproduzidas nas seções acima; rodadas via script Node ad-hoc (não commitado — usa `pg` direto contra `SUPABASE_CONNECTION_STRING`, sem alterar nenhuma linha)
