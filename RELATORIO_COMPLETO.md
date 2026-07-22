# Chuvarada — Relatório Completo do Projeto

**Data deste relatório:** 21/07/2026
**Período coberto:** 18/07/2026 (início do projeto) a 21/07/2026 (estado atual)

Este documento descreve o projeto Chuvarada do zero: o que é, por que existe, como foi construído, quais decisões técnicas e de produto foram tomadas, quais dificuldades reais apareceram no caminho, o que ainda falta, e como rodar tudo localmente. É escrito para alguém que nunca viu o código, mas precisa entender o projeto inteiro — sem inflar o que foi feito nem esconder o que não funcionou ou o que ainda está quebrado.

---

## 1. Visão geral

**Chuvarada** é um PWA (Progressive Web App) que mostra, em tempo real e por bairro, o risco de alagamento em cidades brasileiras. O usuário abre o app, vê um mapa colorido por nível de risco (verde/amarelo/vermelho), pode tocar em qualquer bairro pra ver o detalhamento do cálculo, a previsão do tempo hora a hora, e salvar bairros como favoritos.

### O problema que resolve

O aquecimento global vem tornando eventos de chuva mais intensos e concentrados no tempo — o mesmo volume mensal de chuva que antes se distribuía ao longo de semanas hoje cai em poucas horas. Cidades brasileiras, com infraestrutura de drenagem urbana historicamente subdimensionada, não foram projetadas pra esse regime de chuva mais extremo. O resultado são alagamentos cada vez mais frequentes, muitas vezes em bairros onde o morador não tinha como saber que o risco estava subindo naquele momento específico.

Os alertas oficiais de Defesa Civil, quando existem, costumam ser por cidade ou região inteira — não por bairro — e nem toda cidade tem esse serviço ativo e atualizado. O Chuvarada tenta preencher esse vão: cruzar dados públicos (clima, terreno, hidrografia, maré) num modelo simples e transparente, atualizado a cada hora, granular o suficiente pra dizer "este bairro específico" em vez de "esta cidade inteira".

### Público-alvo

Cidadão comum, não especialista — alguém que quer decidir rapidamente "posso sair de casa agora?" ou "preciso me preocupar com este bairro que estou monitorando?". O app evita jargão técnico na interface (a página `/como-funciona` existe justamente pra explicar o modelo em linguagem simples) e prioriza clareza visual sobre densidade de informação.

### Posicionamento

O Chuvarada se posiciona como **complemento** à informação pública, não como crítica ao poder público. A Defesa Civil, o INMET, a Marinha do Brasil (CPTEC) e o IBGE já produzem dados de excelente qualidade — o que falta, na maior parte das cidades, é alguém cruzando esses dados publicamente disponíveis num formato acessível e granular o bastante pra uso individual. O rodapé do app resume essa postura: *"O Chuvarada complementa a informação pública, colocando dados abertos do governo nas mãos do cidadão comum. Não é crítica ao poder público — é parceria."*

---

## 2. Cobertura atual

| Métrica | Valor |
|---|---:|
| Estados | **16** (Nordeste completo + Sul + Sudeste) |
| Municípios | **4.653** (100% dos municípios IBGE desses estados) |
| Bairros/distritos/subdistritos | **24.556** |
| Com score de risco calculado | **100%** |
| Municípios costeiros | 292 |
| Municípios costeiros com estação de maré (`tide_code`) | 110 (37,7%) |

### Nível de dado por cidade (`data_level`)

| Nível | Cidades | O que significa |
|---|---:|---|
| `full` | 3 | Salvador (BA), Recife (PE), Natal (RN) — bairro real + hidrografia municipal refinada |
| `partial` | 91 | Capitais e cidades grandes com hidrografia local/regional adicional ou shapefile municipal de bairro, sem o refinamento completo das 3 `full` |
| `minimal` | 4.559 | Modelo baseado em clima, terreno e hidrografia nacional (BHO), sem refinamento local |

### Por estado

| Estado | Município | Nordeste/Sul/Sudeste |
|---|---:|---|
| AL, BA, CE, MA, PB, PE, PI, RN, SE | 1.794 | Nordeste (cobertura original) |
| ES, MG, PR, RJ, RS, SC, SP | 2.859 | Sul + Sudeste (expansão de 20-21/07/2026) |

### O que falta cobrir

**Centro-Oeste e Norte** — ainda sem nenhum dado. Ficaram de fora da expansão Sul/Sudeste por ordem de prioridade de produto (ver seção 9): Sul e Sudeste concentram mais população urbana e mais eventos de chuva intensa documentados publicamente do que Centro-Oeste e Norte, então entraram primeiro.

### Por que São Paulo, Campinas e Sorocaba usam distrito em vez de bairro

O Censo 2022 do IBGE não preenche `NM_BAIRRO` para esses 3 municípios — só `NM_DIST` (distrito administrativo, uma subdivisão bem mais grossa que bairro urbano de verdade). Investigado como possível bug de pipeline (diagnóstico de 20/07/2026): não é. Conferido também o shapefile bruto do IBGE (a granularidade grossa já vem da fonte, não é perda no processamento) e o portal de dados abertos da própria Prefeitura de São Paulo (GeoSampa) — que também só disponibiliza distrito, não bairro, para consulta programática. Decisão: manter distrito como aproximação, com `name_source='distrito'` sinalizando a diferença na UI, em vez de tentar uma fonte alternativa não oficial (ver seção 9, "OSM para bairros de SP").

De forma mais ampla, **cerca de 46% dos 24.556 registros são distrito/subdistrito, não bairro nomeado** — limitação estrutural do Censo 2022 para municípios menores do interior em todo o país, não específica de SP.

---

## 3. Stack técnico completo

| Camada | Tecnologia | Por quê |
|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS | App Router permite rotas de API (`app/api/`) e páginas no mesmo projeto — o cron de atualização de risco roda como uma rota Next mesmo, sem infraestrutura extra. TypeScript pega erros de schema em tempo de compilação. |
| Mapa | Leaflet.js + tiles CartoDB Dark Matter | Leve, sem chave de API paga, suporte maduro a polígonos GeoJSON (bairro é desenhado como polígono real). Canvas renderer (`preferCanvas: true`, 21/07) em vez do SVG padrão — com milhares de polígonos num viewport largo, SVG cria um `<path>` por feature (caro de repintar); Canvas desenha tudo numa única superfície de bitmap. |
| Animações | Framer Motion | Transições do painel de bairro, coração de favorito, banners. |
| Gráficos | Recharts | Histórico de score por bairro (`HistoryChart`). |
| Banco | Supabase (Postgres gerenciado + Auth + Realtime + RLS) | Banco relacional de verdade (joins entre `neighborhoods`/`cities`/`risk_scores`), autenticação pronta, e um canal de Realtime que notifica o frontend assim que uma nova linha entra em `risk_scores` — sem isso, o mapa precisaria de polling manual. |
| Acesso ao banco (server-side) | `pg` (Pool direto), não só o client REST do Supabase | Rotas de API e scripts de backfill escrevem em lote (`insertRiskScoresBatch`, `upload_state_expansion.js`) com mais controle de performance do que o client REST permitiria em volume (24.556 bairros). |
| Clima | Open-Meteo (camada 1) + WeatherAPI.com (camada 2, fallback de emergência) + MERGE/CPTEC (chuva acumulada/pico) | Ver seção 4 — arquitetura evoluiu bastante e foi revertida uma vez. |
| Maré | CPTEC/INPE (scraping HTML) — **atualmente fora do ar**, fallback neutro | Ver seção 4. |
| Pré-processamento geoespacial | Python (geopandas, rasterio, shapely, pyogrio, STRtree do shapely) | Processar shapefiles do IBGE, GeoTIFFs SRTM e geopackages de hidrografia em escala nacional exige ferramentas GIS maduras. |
| PWA | next-pwa | App instalável sem loja de aplicativo, service worker desabilitado em desenvolvimento (`disable: NODE_ENV === 'development'`). |
| Automação | GitHub Actions (`.github/workflows/merge-and-scores-update.yml`) | Um único workflow horário com 2 jobs sequenciais via `needs` (ver seção 6). |

### Decisões de arquitetura tomadas e por quê

- **Carregamento por viewport, não tudo de uma vez** (21/07) — o Supabase/PostgREST tem um teto rígido de 1.000 linhas por requisição (confirmado: nem um `Range` header explícito pedindo mais consegue passar disso). Com 24.556 bairros, o carregamento único antigo só conseguia mostrar ~4% do Brasil — e por acaso nenhum bairro de São Paulo entrava nesse recorte, criando a aparência de "São Paulo não tem dado" quando na verdade era um teto de paginação silencioso. Corrigido com um endpoint (`/api/neighborhoods`) que filtra por bounding box do viewport atual do mapa, usando `centroid_lat`/`centroid_lng` pré-calculados (índice dedicado).
- **Modo cidade no zoom-out** (21/07) — abaixo de um certo zoom, o mapa mostra 1 ponto por cidade (colorido pelo pior nível entre seus bairros) em vez de polígonos de bairro. Motivo duplo: polígonos ficam ilegíveis nessa escala, e o payload de geometria de um viewport largo chegava a ~9MB. A agregação por cidade (`city_risk_summary`) é uma **tabela real**, não uma view calculada na hora — medido com `EXPLAIN ANALYZE` que agregar "o score mais recente de cada bairro" ao vivo leva 1 a 3 segundos mesmo com índice, rápido demais de repetir a cada cron mas devagar demais pra manter o mapa interativo por request. Como o cron já calcula o score de cada bairro de uma cidade de uma vez e tem esse resultado em memória, ele mesmo atualiza a tabela — custo adicional praticamente zero.
- **LATERAL join em vez de view com `DISTINCT ON`** (21/07) — a view `latest_risk_scores` (criada na migração 008), quando usada num `JOIN`, forçava o planner do Postgres a des-duplicar a tabela `risk_scores` inteira (todos os bairros do Brasil) mesmo pra devolver os bairros de um viewport pequeno — ~220ms/188 mil buffer hits pra 124 bairros. Trocado por um `LEFT JOIN LATERAL ... LIMIT 1` (usa o índice `risk_scores_neighborhood_time`), que vira um nested loop buscando só o score de cada bairro já filtrado: ~7ms pro mesmo resultado, ~28x mais rápido.
- **Supabase Realtime com filtro server-side por viewport** — antes assinava todo `INSERT` em `risk_scores` nacionalmente e descartava client-side o que não interessava; com bairros carregados por viewport (dezenas/centenas, não mais 24.556), passou a usar o filtro server-side do Realtime (`neighborhood_id=in.(...)`), com um teto de segurança (500 ids) caindo pro filtro client-side antigo se o viewport for grande demais pro filtro.
- **`mergeNewerScores()` em vez de merge cego de estado** — um bairro pode ter score atualizado por 2 fontes concorrentes (fetch do viewport e Realtime); o fetch pode demorar e resolver *depois* de um evento Realtime mais recente já ter chegado. Um merge cego deixava o fetch atrasado sobrescrever o score novo com o antigo. A função compara `calculated_at` antes de aceitar qualquer atualização, garantindo que a versão mais recente sempre vence.
- **Geometria simplificada (Douglas-Peucker) servida no lugar da original** — tolerância de 0,001° (~100m), escolhida empiricamente (0,0001° cogitado inicialmente não reduzia quase nada, porque a fonte IBGE já tem vértices mais espaçados que isso). Corta ~37% do payload sem distorcer visivelmente o formato do bairro. Coluna nova (`geometry_simplified`), preservando a geometria original intacta.
- **Lock de execução (`system_locks`)** — protege contra 2 disparos do cron simultâneos (ex: disparo manual enquanto o agendado já está no meio do ciclo) e contra a race condition entre o script Python do MERGE e o cron de scores (ver seção 6/7).

---

## 4. Fontes de dados — completo e honesto

### NASA SRTM (via OpenTopography)
- **O que fornece**: elevação do terreno, usada para `terrain_slope` (declividade) por bairro.
- **Como foi obtida**: GeoTIFFs SRTMGL1 via [OpenTopography](https://portal.opentopography.org/), recortes por cidade nas primeiras capitais, depois recortes estaduais maiores.
- **Dificuldades**: cota de **50 chamadas/dia** no plano gratuito, esgotada durante os testes de expansão — contornado processando por lotes/quadrantes ao longo de vários dias.
- **Limitações**: resolução ~30m — suficiente pra declividade agregada por bairro, não pra microtopografia de rua.
- **Status**: ativo.

### BHO/ANA (hidrografia nacional)
- **O que fornece**: cursos d'água usados para `hydro_proximity`.
- **Órgão**: ANA (Agência Nacional de Águas), base BHO (Base Hidrográfica Ottocodificada), geopackage nacional de 2,7GB (2.751.685 feições).
- **Como foi obtida**: `geopandas.read_file()` com bbox pushdown (o GDAL recorta na leitura, sem carregar o Brasil inteiro em memória).
- **Dificuldades**: bbox inicial cortava bordas reais do Nordeste (oeste do MA, sul da BA, litoral leste de PB, Fernando de Noronha) — alargado e reprocessado. Na expansão nacional, `process_bho.py` com `unary_union` + loop não terminou em 64 minutos para Sul/Sudeste — trocado por STRtree (índice espacial), resolvendo o problema de escala.
- **Status**: ativo, base de todo o país.

### IBGE Censo 2022 (setores censitários)
- **O que fornece**: os polígonos de bairro (ou distrito/subdistrito, na ausência de bairro nomeado).
- **Como foi obtida**: shapefile por estado via FTP do IBGE.
- **Dificuldades**: codificação mista UTF-8/Latin-1 nos atributos entre estados; colisão de nomes entre municípios homônimos de estados diferentes (ex: Areia Branca existe em RN e SE).
- **Limitação estrutural**: ~46% dos registros nacionais são distrito/subdistrito, não bairro nomeado — mais pronunciado no interior e em municípios grandes como São Paulo/Campinas/Sorocaba (ver seção 2).
- **Status**: ativo, fonte primária de geometria em todo o país.

### MERGE/CPTEC (precipitação — satélite + pluviômetros)
- **O que fornece**: `rain_72h` e `rain_peak_3h` — chuva acumulada e pico, combinando satélite (GPM/IMERG) e pluviômetros do INMET em uma grade de ~10km, publicada pelo CPTEC/INPE.
- **Como foi obtida**: `scripts/fetch_merge_cptec.py`, rodando a cada hora via GitHub Actions, grava em `merge_cache`.
- **Dificuldades**: um quadrante do Maranhão baixou truncado uma vez (HTTP 200 mas arquivo cortado) — corrigido com validação completa do raster antes de mesclar. Grid de célula aumentado para 0,1° e rate limiter trocado de "por hora" para contador diário durante a expansão nacional, pra escalar de ~1.800 pra ~4.650 cidades sem estourar limites.
- **Status**: **ativo, fonte principal de chuva acumulada/pico** em todo o país.

### Open-Meteo (variáveis secundárias + camada 1 de fallback)
- **O que fornece**: `rain_1h`, vento, umidade, pressão — e, quando é a camada ativa, também serve de origem alternativa pra `rain_72h`/`rain_peak_3h` via `past_days=3` (comparado com o MERGE, usa o maior valor).
- **Por que é camada 1 de novo**: o projeto tentou migrar `rain_1h`/vento/umidade/pressão pra WeatherAPI.com em 21/07 (ver abaixo), mas revertida no mesmo dia — cota real da Open-Meteo (10.000 chamadas/dia) é maior que a do plano gratuito da WeatherAPI (3.333/dia), e o plano Business contratado da WeatherAPI só é válido até 28/07/2026 (não é uma solução durável).
- **Status**: ativo, camada 1.

### WeatherAPI.com (fallback de emergência)
- **O que fornece**: mesmas variáveis da Open-Meteo, usada só quando a Open-Meteo falha ou esgota a cota do dia.
- **Status**: ativo como **camada 2** (reserva de emergência) — não como fonte primária. Precisa de `WEATHERAPI_KEY` configurada.

### CPTEC/maré (scraper) — **INATIVO**
- **O que fornecia**: nível de maré (0 a 1), 8% do peso do modelo, via scraping HTML da tábua oficial da Marinha do Brasil publicada pelo CPTEC.
- **Status atual**: **fora do ar** — confirmado por inspeção direta do HTML (não é mudança de layout que quebrou o parser: a página retorna uma tabela genuinamente vazia para qualquer estação/mês/ano testado, incluindo meses passados que deveriam ter dado histórico).
- **O que foi investigado como alternativa**: o antigo webservice estruturado da Marinha foi descontinuado em 2018. A fonte real hoje é um PDF anual por estação (`marinha.mil.br/chm/.../tabua_{ano}_0.pdf`), confirmado tecnicamente parseável via `pdfplumber` num exemplo de 2023 — mas as páginas de listagem necessárias pra descobrir a URL de cada estação pro ano corrente retornam 403 (WAF), e o padrão de URL de anos anteriores não se estende a 2026 (404).
- **Decisão**: formalizar o fallback neutro (0,5) em vez de investir na integração com o PDF da Marinha agora — ver seção 9. `EMPTY_TIDE_RETRY_HOURS=24` evita bater no endpoint morto a cada ciclo de cron pra cada cidade costeira.
- **Impacto**: `tide_level` fica sempre neutro (0,5) para as 110 cidades com `tide_code` cadastrado; o peso de 8% cai no mesmo mecanismo de redistribuição já usado para cidades sem estação — não há dado incorreto sendo exibido, só a variável temporariamente fora do cálculo real em todo o país.

### Defesa Civil / S2ID — tentado, com limitações
- **O que é**: Sistema Integrado de Informações sobre Desastres — reconhecimentos oficiais de Situação de Emergência/Estado de Calamidade por decreto municipal.
- **Limitação séria**: granularidade por município, não por bairro — não dá pra validar o modelo (que é por bairro) diretamente. Também não havia eventos de alagamento datados suficientes no período coberto pra uma validação estatística robusta.
- **Status**: tentado, não deu no resultado esperado (ver seção 9).

### Hidrografia local: Recife
- **Órgão**: Prefeitura do Recife (dados abertos, faixas marginais dos recursos hídricos).
- **Status**: integrado — `process_hydro_recife.py` combina com a BHO regional (prioriza dado local, completa com BHO numa vizinhança de ~11km).

### Hidrografia local: Paraíba (AESA)
- **Órgão**: AESA (Agência Executiva de Gestão das Águas da Paraíba).
- **Status**: baixado, ainda não integrado ao cálculo final (a PB já tem 100% de `hydro_proximity` real via BHO; fica como melhoria de precisão futura).

### Hidrografia local: Sergipe (SERhidro)
- **Órgão**: SEMAC/SERhidro (geoportal estadual).
- **Status**: integrado — `process_hydro_sergipe.py` combina com a BHO via `max()` por bairro (nunca substitui, sempre complementa — substituir seria regressão, já que a base estadual é mais esparsa em riachos intermitentes que a BHO nacional).

### Bairros municipais: Aracaju (MapAju)
- **Status**: obtido — geoportal oficial ativo, exportação direta, geometria oficial de bairro real usada em vez de setor censitário.

### BRAMS/CPTEC — investigado, descartado
- **O que é**: modelo de previsão numérica regional do CPTEC.
- **Motivo do descarte**: ciclo de publicação de 1x por dia — regressão frente à Open-Meteo/MERGE, que atualizam por hora.

### INMET — investigado, parcialmente inviável
- **O que é**: Instituto Nacional de Meteorologia, rede de estações automáticas com dado horário real (pluviômetro físico, não estimativa de satélite).
- **Limitação**: API horária exige token de acesso — processo de solicitação burocrático, não resolvido nesta fase. INMET já é usado indiretamente (dados de precipitação extrema histórica importados para `historical_events`, e o próprio MERGE/CPTEC incorpora pluviômetros do INMET na sua grade combinada).

### NASA GPM IMERG — investigado, substituído pelo MERGE
- **O que é**: dado de precipitação por satélite da NASA, componente também usado pelo MERGE/CPTEC.
- **Motivo**: acesso direto exige conta NASA Earthdata — processo mais burocrático que consumir o produto já combinado (satélite + pluviômetro) publicado pelo CPTEC via MERGE, que entrega o mesmo tipo de dado com menos fricção de acesso.

---

## 5. Modelo de risco — documentação técnica completa

### Variáveis e pesos atuais

| Variável | Peso | Fonte | Normalização |
|---|---:|---|---|
| `rain_peak_3h` | 25% | MERGE/CPTEC (ou Open-Meteo, o maior dos dois) | 0mm/h→0, 10mm/h→0,5, 30mm/h→1,0 |
| `rain_1h` | 20% | Open-Meteo (camada 1) / WeatherAPI.com (camada 2) | 0mm→0, 25mm→0,5, 50mm→1,0 |
| `rain_72h` | 20% | MERGE/CPTEC (ou Open-Meteo, o maior dos dois) | 0mm→0, 50mm→0,5, 100mm→1,0 |
| `terrain_slope` | 15% | NASA SRTM | pré-processado |
| `hydro_proximity` | 12% | ANA/BHO + hidrografia local | pré-processado |
| `tide_level` | 8% | CPTEC (fallback neutro 0,5 — fonte fora do ar, ver seção 4) | 0 a 1 |

A normalização usa `normalizeLinear(valor, meio, máximo)` — interpolação linear em dois trechos usando o ponto médio como referência de 0,5, não uma reta única até o máximo. Dá mais sensibilidade na faixa "moderada" da variável.

### Evolução do modelo

- **`rain_intensity` → `rain_peak_3h`** (19-20/07): a variável antiga capturava só o valor exato do instante em que o cron rodava. Picos de chuva convectiva tropical costumam durar menos que o intervalo entre execuções do cron — um pico podia já ter passado e nunca ser "visto". `rain_peak_3h` resolve pegando o máximo horário das últimas 3 horas.
- **Limiares 0,4/0,7 → 0,3/0,6** (20/07): motivado por um evento real de chuva em Recife (bairro Nova Descoberta, `rain_72h=56,74mm`) que gerou score 0,380 — classificado como "normal" com os limiares antigos, apesar de já ter chuva acumulada significativa.
- **Maré condicional**: só entra no cálculo em cidades com `tide_code` cadastrado; sem isso, o peso de 8% é redistribuído proporcionalmente entre as 5 variáveis restantes, mantendo a soma em 1,0 — em vez de usar um valor neutro fingindo dado real.
- **Guarda de recência na regra de maré+costa** (achado do relatório de testes pré-deploy): a regra 2 de crítico automático (maré alta + chuva costeira) só dispara se o dado de maré usado tiver menos de 26h — margem que cobre um ciclo completo de maré (~6h) mais folga. Sem isso, aplicar a regra sobre um `tide_level` muito antigo (comum quando 89% das cidades usam `weather_cache` expirado na maior parte do tempo) arriscaria disparar — ou deixar de disparar — com base numa maré que já não é a de agora.

### Regras de crítico automático

Independente do score ponderado, o bairro entra direto em crítico se:
1. `rain_1h > 50mm` — chuva extrema na última hora.
2. `tide_level > 0,8` **e** `rain_3h > 20mm` **e** bairro costeiro **e** `tide_code` cadastrado **e** dado de maré com menos de 26h.
3. `rain_72h > 100mm` **e** `rain_1h > 0` — solo saturado recebendo qualquer chuva nova.

### Validações com eventos reais

- **Natal, 18-19/07/2026**: 102mm em 24h — o modelo classificou corretamente como crítico.
- **Natal, 21/07/2026**: 17 pontos de alagamento noticiados na cidade — 13 dos 13 bairros correspondentes já estavam em crítico no modelo. Esse mesmo incidente expôs uma race condition real entre o script do MERGE e o cron de scores (ver seção 7), corrigida no mesmo dia.
- **Rio Grande do Sul, frente fria** (expansão Sul/Sudeste): ~95% dos bairros do estado em atenção/crítico simultaneamente — padrão consistente com chuva frontal (frente cobrindo o estado inteiro), diferente do padrão localizado/convectivo típico do Nordeste. Validação qualitativa de que o modelo responde de forma coerente a um regime de chuva bem diferente do que foi originalmente calibrado.

### Limitações honestas do modelo

- Sem dado de bueiros ou galerias pluviais — não disponível publicamente em nenhuma cidade mapeada nesta pesquisa.
- `rain_72h`/`rain_peak_3h` são estimativas de modelo numérico (satélite + pluviômetro combinados via MERGE), não medição física por pluviômetro em cada bairro.
- Eventos convectivos muito localizados podem ser subestimados pela grade de ~10km do MERGE — no caso de Natal o MERGE capturou bem, mas isso não garante captura de todo evento sub-grade.
- A validação histórica (`historical_events`) existe mas não tem eventos datados por bairro suficientes para uma validação estatística robusta — os casos reais de Natal/RS acima são validação qualitativa pontual, não um backtesting sistemático.

---

## 6. Arquitetura de dados — pipeline completo

### Pré-processamento (Python, offline, por estado/cidade)

1. **Download** — IBGE (setores censitários), SRTM (OpenTopography), BHO/ANA (geopackage nacional), hidrografias locais (Recife/Paraíba/Sergipe), shapefile de bairro de Aracaju.
2. **`process_neighborhoods.py`** / **`process_state_neighborhoods.py`** — dissolve setores censitários em polígonos de bairro, marca `is_coastal`, exporta GeoJSON com placeholders de `terrain_slope`/`hydro_proximity`.
3. **`process_srtm.py`** — calcula declividade real a partir do GeoTIFF, agrega por bairro, preenche `terrain_slope` *in-place*.
4. **`process_bho.py`** — distância de cada bairro ao curso d'água nacional mais próximo (STRtree), normaliza e preenche `hydro_proximity`.
5. **`process_hydro_recife.py`** / **`process_hydro_sergipe.py`** — refinam `hydro_proximity` com hidrografia local, via `max()` com a BHO.
6. **`upload_neighborhoods.js`** / **`upload_state_expansion.js`** — inserem em lote via `pg` direto (`city_id`, `name`, `geometry`, `geometry_simplified`, `terrain_slope`, `hydro_proximity`, `is_coastal`, `name_source`, `centroid_lat`/`lng`).

### Ciclo de atualização (produção, a cada hora)

```
GitHub Action (.github/workflows/merge-and-scores-update.yml, "0 * * * *"):

1. update_merge: fetch_merge_cptec.py → merge_cache
   (precipitação MERGE/CPTEC pra todo o Brasil coberto, grade ~10km)

2. update_scores (needs: update_merge, só roda depois do 1 terminar):
   /api/cron/update → risk_scores (score de cada bairro)
   ├── Open-Meteo (camada 1): rain_1h/vento/umidade/pressão
   │     (TTL do cache: 24h se célula seca, 3h se célula com chuva)
   ├── WeatherAPI.com (camada 2): fallback se Open-Meteo esgotar/falhar
   ├── weather_cache existente <24h (camada 3): fallback se as 2 acima falharem
   └── Neutro (camada 4): último recurso, nunca deixa um bairro sem nenhum dado
   → upsertCityRiskSummary: agregado por cidade atualizado no mesmo passo
     (sem query extra — já tem o score de cada bairro em memória)
```

A ordem por `needs` (não por horário/offset entre 2 workflows separados) existe especificamente porque rodar os dois em paralelo causava uma race condition real: parte dos bairros liam célula de `merge_cache` já atualizada nessa rodada, parte liam célula ainda não tocada (caindo pro fallback Open-Meteo, subestimando a chuva) — descoberto no incidente de Natal de 21/07/2026.

### Supabase Realtime

O frontend assina `INSERT` em `risk_scores` filtrado pelos bairros visíveis no viewport atual (filtro server-side quando o viewport tem até 500 bairros, client-side como fallback de segurança acima disso). O mapa atualiza a cor do bairro automaticamente, sem reload. `mergeNewerScores()` (comparando `calculated_at`) garante que um fetch de viewport atrasado nunca sobrescreve um score mais novo já recebido via Realtime.

---

## 7. Bugs encontrados e corrigidos

### Bugs de dados
1. **`NORDESTE_BBOX` cortando municípios nas bordas** (MA, PB, PI, PE) → alargado para `(-49,5, -19,0, -31,5, -1,5)`.
2. **São Luís sem bairros** por skip silencioso no upload (já existia em `cities` de uma tentativa anterior, sem checar se tinha bairro associado) → corrigido com INSERT pontual do dado já processado.
3. **`tide_code` duplicado** entre Areia Branca/RN e Areia Branca/SE (mapa de códigos indexado só por nome, sem UF) → UPDATE removendo o código de SE, chave trocada para `nome::estado`.
4. **8 bairros com `terrain_slope` placeholder** (Fernando de Noronha, Equador/RN — fora dos bounding boxes originais) → backfill com SRTM real via OpenTopography.
5. **`hydro_proximity=0` por bbox nacional cortando bordas dos estados** → bbox alargado e reprocessado.
6. **`name_source` nulo em 17.439 bairros do Sul/Sudeste** → backfill a partir dos GeoJSONs de origem.
7. **77 atribuições incorretas de `tide_code` por distância** (bug no script de atribuição por proximidade) → revertidas e refeitas com referência às cidades-sede reais das estações.
8. **Codificação mista UTF-8/Latin-1** nos shapefiles do IBGE → função de correção de dupla-codificação no pipeline.
9. **Litoral subestimado** por usar centroide do bairro em vez do polígono inteiro para calcular distância à costa → trocado para distância do polígono completo.
10. **Colisão de nomes entre municípios homônimos** de estados diferentes → chave trocada de `nome` para `(nome, estado)`.
11. **`MERGE_BBOX` não cobrindo Sul/Sudeste** → alargado para `BRASIL_BBOX = (-57,7, -33,8, -31,5, -1,5)`.

### Bugs de pipeline
12. `process_srtm.py` salvando resultado em arquivo separado em vez de atualizar `terrain_slope` *in-place* nos GeoJSONs.
13. `process_bho.py` gerando artefatos intermediários dentro de `public/geojson/` → movidos para `dados-brutos/`.
14. `process_hydro_recife.py` quebrando por CRS incompatível (WGS84 vs SIRGAS2000).
15. `process_bho.py` com `unary_union` + loop não terminando em 64min pra Sul/Sudeste → trocado por STRtree (índice espacial).
16. Script de upload pulando São Luís silenciosamente (nome já existia em `cities`) — mesma causa raiz do bug #2.
17. `fetch_merge_cptec.py`: quadrante do Maranhão baixado truncado (HTTP 200 mas arquivo cortado) → validação completa do raster antes de mesclar.

### Bugs de modelo
18. `rain_72h` calculado a partir de previsão futura (limitação do plano gratuito da fonte original) → trocado para uma fonte com histórico observado real (`past_days`).
19. `rain_intensity` capturando só o instante atual, perdendo picos entre execuções do cron → trocado para `rain_peak_3h` (máximo das últimas 3h).
20. Limiares conservadores demais (0,4/0,7): 56mm/72h em Recife ficou "normal" → ajustado para 0,3/0,6 após evento real.
21. Fonte de MERGE priorizada cegamente sobre a fonte secundária → implementado `getBestRainData()` com lógica de comparação (usa o maior valor entre as duas).

### Bugs de frontend
22. **PostgREST retornando só 1.000 bairros** (teto rígido, confirmado que nem `Range` header explícito consegue passar) → carregamento por viewport com `/api/neighborhoods`, filtrando por `centroid_lat`/`centroid_lng`.
23. **View `latest_risk_scores` congelada** após `ALTER TABLE ADD COLUMN` — Postgres congela a lista de colunas de uma view `select *` no momento da criação, não acompanha colunas adicionadas depois na tabela (`rain_peak_3h`, `rain_source` ficaram de fora) → recriada na migração 020.
24. **Deep-link `?bairro=` nunca abrindo o painel** — race condition: o efeito de auto-abertura tinha `flyTo` nas dependências, e a identidade de `flyTo` muda assim que o mapa deixa de ser `null` (poucos ms após o mount); isso reiniciava o efeito e cancelava o fetch em andamento antes da resposta chegar → corrigido isolando esse caminho num efeito mount-only com uma ref estável.
25. **Race condition entre fetch do viewport e Supabase Realtime** — fetch atrasado sobrescrevendo score mais novo já recebido via Realtime, fazendo o polígono do mapa voltar a ficar verde mesmo com o painel já mostrando crítico → corrigido com `mergeNewerScores()` comparando `calculated_at`.
26. Card de alerta nunca mostrava dados de clima (condição mutuamente exclusiva com o estado de bairro selecionado).
27. Previsão idêntica em todos os bairros de uma cidade (usando centroide da cidade, não do bairro) → trocado para centroide do bairro via `turf.centroid`.
28. Cron rodou parcialmente uma vez (timeout de 670s) — ES e MG ficaram com processamento incompleto → segunda execução completou.

### Bugs de infraestrutura
29. GitHub Action do MERGE nunca tinha sido de fato ativada em produção (workflow existia no código, secrets nunca configurados) → documentado em `SETUP_ACTIONS.md` + lock de escrita implementado antes de ativar de verdade.
30. Race condition entre `fetch_merge_cptec.py` e o cron de scores rodando em paralelo/fora de ordem → `system_locks` com acquire/release + jobs sequenciais via `needs` no workflow unificado.
31. `Number(env) || default` tratando `"0"` como falsy no rate limiter (um valor de configuração igual a zero caía silenciosamente pro default) → corrigido com um helper que só usa o default quando a env var está de fato ausente/inválida, não quando é zero.
32. Cota diária esgotada durante sessão de testes intensivos → rate limiter diário + modo `WEATHER_CACHE_ONLY` pra desenvolvimento sem consumir cota.
33. Cota de 50 chamadas/dia do OpenTopography esgotada durante a expansão → baixado em quadrantes/lotes menores ao longo de vários dias.

---

## 8. O que foi tentado e não funcionou

- **Validação histórica com S2ID** — granularidade por município (não por bairro) e poucos eventos de alagamento datados no período coberto impediram validação estatística robusta.
- **TideLevelAPI** — domínio morto.
- **CPTEC/maré** — página com tabela vazia (serviço degradado do lado do órgão, sem solução do lado do cliente).
- **Webservice estruturado da Marinha** — descontinuado em 2018.
- **PDF da Marinha** — tecnicamente parseável, mas as URLs de descoberta por estação para 2026 retornam 403 (WAF) ou 404 (padrão de anos anteriores não se estende).
- **INMET API horária** — exige token, processo burocrático não resolvido nesta fase.
- **NASA GPM IMERG direto** — requer conta NASA Earthdata.
- **Google Earth Engine** — requer conta Google + Earth Engine habilitado.
- **BRAMS/CPTEC** — ciclo de publicação de 1x/dia é regressão frente à Open-Meteo/MERGE (atualização por hora).
- **OSM para bairros de São Paulo** — decidido manter consistência com a fonte IBGE em vez de misturar fontes de granularidade/critério diferentes.
- **Shapefiles de Teresina e João Pessoa** — portais municipais protegidos por WAF, automação bloqueada.
- **Hidrografia local do Ceará (IPECE)** — geoportal inacessível.
- **Hidrografia local de Sergipe (SERhidro), parte via ArcGIS Hub** — parte do dado só carrega via JavaScript executado no navegador, não em requisição HTTP direta (contornado usando o subconjunto que respondia a requisição direta).

---

## 9. Decisões de produto tomadas

- **Granularidade por bairro, não grid fixo** — mais intuitivo pro usuário do que uma grade arbitrária de células, mesmo custando mais trabalho de pré-processamento geoespacial.
- **PWA em vez de app nativo** — instala direto do navegador, sem loja de aplicativo, mesmo código pra iOS/Android, iteração rápida num projeto com modelo e cobertura ainda em evolução ativa.
- **Mapa abre no viewport dinâmico, carrega por área visível** — em vez de forçar escolha de cidade primeiro, ou tentar carregar o Brasil inteiro de uma vez (inviável pelo teto de 1.000 linhas do PostgREST).
- **Empty states por nível de dado, não ocultar áreas sem cobertura** — uma área sem bairro processado ainda aparece no mapa com um estado visual claro ("cobertura em expansão"), em vez de simplesmente não existir visualmente (o que poderia ser confundido com "sem risco").
- **Bairros sem nome real exibidos de forma transparente** — "Área sem denominação oficial" em vez de fingir que um distrito é um bairro nomeado.
- **Maré condicional** — peso redistribuído em vez de mostrar linha de maré onde não há estação confiável nas proximidades.
- **Open-Meteo → MERGE para precipitação** — histórico observado real em vez de estimativa/previsão, decisão que se manteve mesmo depois da tentativa (e reversão) de migrar `rain_1h` para WeatherAPI.com.
- **Limiares ajustados após evento real** em Natal, não teoricamente.
- **Não atribuir `tide_code`** para municípios a mais de 80km de qualquer estação — dado de baixa confiança seria pior que a ausência de dado.
- **Combinar hidrografia local + BHO com `max()`**, nunca substituir — evita que um dado local mais esparso em algumas áreas piore a cobertura geral que a BHO já oferecia.
- **Posicionamento como parceiro do poder público, não crítico** — decisão de tom e comunicação, refletida no rodapé do app e em `/como-funciona`.
- **WeatherAPI.com como fallback de emergência, não fonte primária** — decisão revertida uma vez (21/07): a WeatherAPI chegou a ser camada 1, mas a cota do plano gratuito da Open-Meteo é maior e mais durável que o plano Business contratado da WeatherAPI (que expira 28/07/2026).
- **Manter distritos do IBGE para SP/Campinas/Sorocaba** — consistência de fonte e critério em vez de misturar com um dado municipal de granularidade diferente.
- **Formalizar fallback neutro de maré** em vez de investir agora na integração com o PDF da Marinha (decisão explícita do usuário, com as alternativas — investir no PDF, ou só pausar e reportar — descartadas).
- **Modo cidade com `CircleMarker` no zoom-out** (Opção A, entre as alternativas discutidas) — pontos coloridos por cidade em vez de manter polígonos de bairro ilegíveis/pesados numa escala de zoom-out.
- **Sul e Sudeste antes de Centro-Oeste e Norte** — maior concentração de população urbana e de eventos de chuva intensa documentados publicamente.

---

## 10. Limitações conhecidas e documentadas

### Estruturais (sem solução técnica imediata)
- **Maré sempre em 0,5** — fonte CPTEC fora do ar; alternativa real (PDF da Marinha) exige um projeto separado de descoberta de URL por estação + parser de PDF.
- **São Paulo, Campinas e Sorocaba com distrito, não bairro** — o Censo 2022 do IBGE não tem `NM_BAIRRO` pra essas cidades; o próprio GeoSampa (portal da Prefeitura de SP) também só disponibiliza distrito.
- **Interior do Brasil sem bairro nomeado** (~46% dos registros são distrito/subdistrito) — limitação do Censo 2022 pra municípios pequenos, em todo o país.
- **Eventos convectivos muito localizados podem ser subestimados** pela grade de ~10km do MERGE — capturado corretamente no caso de Natal, mas reconhecido como limitação estrutural para eventos ainda menores que a célula.

### De cobertura
- **Centro-Oeste e Norte** ainda sem cobertura nenhuma.
- **Cidades a mais de 80km de qualquer estação de maré** ficam intencionalmente sem `tide_code`.
- **Hidrografia local do Ceará** sem fonte alternativa disponível (IPECE inacessível).

### De infraestrutura
- **GitHub Actions precisam de secrets configurados manualmente** antes do primeiro deploy real (`SUPABASE_CONNECTION_STRING`, `CRON_SECRET`, `APP_URL` — ver `scripts/SETUP_ACTIONS.md`).
- **`flyTo` animado do Leaflet não completa em ambiente de navegador headless/aba em segundo plano** — descoberto testando a feature de modo cidade (21/07): o Chromium suspende `requestAnimationFrame` quando `document.hidden=true`, e o `flyTo` depende disso pra animar. Não é um bug do app — confirmado via `setView` (sem animação) que a lógica de navegação em si funciona corretamente; só a *animação* não roda em aba de fundo.

---

## 11. O que falta fazer

### Antes do deploy
- Configurar os secrets no GitHub (`SUPABASE_CONNECTION_STRING`, `CRON_SECRET`, `APP_URL`) — ver `scripts/SETUP_ACTIONS.md`.
- Testar a GitHub Action via `workflow_dispatch` manual.
- Definir a plataforma de deploy (Vercel/Netlify cogitados, nenhuma decidida ainda).

### Pós-deploy prioritário
- Expandir cobertura para Centro-Oeste e Norte.
- Investigar alternativa real para dados de maré (descobrir URL do PDF anual da Marinha por estação + parser).
- Notificações push — tabela `notifications` já existe no schema, UI e lógica de envio não implementadas.
- Documentação final consolidada no Notion.

### Melhorias futuras
- Integração com API horária do INMET (token necessário) para pluviômetros reais complementares ao MERGE.
- Validação histórica sistemática do modelo com eventos datados por bairro (hoje só há validação qualitativa pontual — Natal, RS).
- Ajuste fino de pesos do modelo para diferenciar chuva frontal (padrão do Sul) de chuva convectiva (padrão do Nordeste) — hoje o mesmo conjunto de pesos serve os dois regimes.
- Shapefile de bairro real para São Paulo, Campinas e Sorocaba, se/quando uma fonte pública oficial surgir.

---

## 12. Estrutura do repositório

```
app/                          Rotas Next.js (App Router)
├── api/
│   ├── cron/update/            Cron principal — recalcula risco de todos os bairros
│   ├── neighborhoods/           Bairros por viewport (bbox) + score embutido + lookup por id
│   ├── cities-summary/           Agregado por cidade pro modo "pontos" no zoom-out
│   ├── forecast/                  Previsão do tempo (atual + 12h) por coordenada
│   ├── score/                      Score de risco por bairro
│   ├── tide/                        Nível de maré por cidade
│   └── weather/                      Clima bruto por coordenada
├── auth/                        Página de login/cadastro
├── favoritos/                    Página de bairros salvos
├── como-funciona/                  Explicação do modelo em linguagem simples
└── page.tsx                        Página principal (mapa)

components/
├── map/                         MapContainer, NeighborhoodLayer, CityMarkerLayer, EmptyStateLayer
├── panel/                        DetailPanel, ScoreBreakdown, ForecastStrip, HistoryChart
├── ui/                            AlertCard, CityHeader, MapLegend, InfoButton/Modal, WeatherIcons etc.
└── how-it-works/                    RiskDiagram, VariableCard, SourcesList (usados em /como-funciona)

lib/                             Integrações e motor de risco
├── score.ts                       Cálculo do score de risco (motor principal)
├── weather.ts                       Orquestração de clima (cache, MERGE, fallback em camadas, rate limiting)
├── weatherapi.ts                     Integração WeatherAPI.com (camada 2, fallback de emergência)
├── merge.ts                           Leitura do merge_cache (chuva MERGE/CPTEC)
├── cptec.ts                            Integração CPTEC (maré — atualmente fallback neutro)
├── db.ts                                Pool de conexão Postgres direta
├── supabase.ts                           Client Supabase (Auth, Realtime)
├── grid.ts                                Agrupamento geográfico em células (~10km)
├── geojson.ts                              Utilitários de geometria (localizar bairro por ponto, estilos)
├── neighborhoodName.ts                       Lógica de nome real vs. fallback
└── metricInfo.ts                               Textos explicativos das métricas (botões de "?")

hooks/                           useAuth, useFavorites, useForecast, useMap, useRealtime, useRisk, useIsDesktop

scripts/                         Pré-processamento Python + upload + diagnósticos
├── process_neighborhoods.py / process_state_neighborhoods.py    Setores censitários → polígonos de bairro
├── process_srtm.py                  SRTM → terrain_slope
├── process_bho.py                     BHO/ANA → hydro_proximity (nacional, via STRtree)
├── process_hydro_recife.py / process_hydro_sergipe.py    Hidrografia local (refinamento)
├── coastal_hydro_proximity.py           Distância à linha de costa (fallback pra bairros costeiros)
├── fetch_merge_cptec.py                   MERGE/CPTEC → merge_cache
├── upload_neighborhoods.js / upload_state_expansion.js     Upload em lote pro Supabase
├── backfill_*.js                            Backfills pontuais (centroides, geometria simplificada, name_source, city_risk_summary)
├── fix_*.js                                  Correções pontuais pós-upload
├── assign_tide_by_proximity.js                 Atribuição de tide_code por distância
├── SETUP_ACTIONS.md                              Guia de configuração dos secrets do GitHub Actions
└── sql/                                            Migrações numeradas (001 a 022)

public/geojson/                 Dados processados servidos estaticamente ao frontend
dados-brutos/                   Dados brutos baixados (fora do git para os arquivos grandes — ver .gitignore)
```

---

## 13. Como rodar localmente

### Pré-requisitos
- Node.js e npm
- Python 3 com `geopandas`, `rasterio`, `shapely`, `pyogrio` (só necessário para os scripts de pré-processamento geoespacial)
- Uma instância Supabase com as migrações de `scripts/sql/` aplicadas em ordem (001 a 022)

### Variáveis de ambiente (`.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_DB_PASSWORD=
SUPABASE_CONNECTION_STRING=
CRON_SECRET=
WEATHERAPI_KEY=

# Opcional — modo de desenvolvimento
WEATHER_CACHE_ONLY=false
```

### Instalar e rodar
```bash
npm install
npm run dev
```
Abre em `http://localhost:3000`.

### Rodar os scripts Python de pré-processamento
```bash
# Exemplo: processar bairros de um estado inteiro
python scripts/process_state_neighborhoods.py --state SP \
  --input dados-brutos/ibge/sp/SP_setores_CD2022.shp

# Preencher terrain_slope a partir do SRTM, in-place no GeoJSON
python scripts/process_srtm.py --input dados-brutos/srtm/srtm_sp.tif \
  --neighborhoods public/geojson/neighborhoods_state_sp.geojson

# Preencher hydro_proximity a partir da BHO nacional
python scripts/process_bho.py --input dados-brutos/ana/geoft_bho_curso_dagua.gpkg \
  --neighborhoods public/geojson/neighborhoods_state_sp.geojson
```

### Forçar o cron manualmente
```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/update
```
Recalcula o score de risco de todos os 24.556 bairros — pode levar vários minutos e consome cota da Open-Meteo/WeatherAPI.

### Desenvolvimento sem consumir cota de clima
```
WEATHER_CACHE_ONLY=true
```
Força o app a sempre usar o `weather_cache` já existente (mesmo expirado) em vez de chamar Open-Meteo/WeatherAPI — útil pra testar UI/lógica sem gastar a cota diária.

---

*Relatório gerado a partir do estado real do código, banco de dados (consultado diretamente em produção) e histórico de commits do repositório em 21/07/2026.*
