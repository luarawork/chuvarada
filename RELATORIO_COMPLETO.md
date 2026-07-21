# Relatório Completo — Chuvarada

**Data deste relatório:** 2026-07-19
**Período coberto:** 2026-07-18 (início do projeto) a 2026-07-19 (estado atual)

Este documento descreve o projeto Chuvarada do zero: o que é, por que existe, como foi construído, quais decisões técnicas e de produto foram tomadas, quais dificuldades reais apareceram no caminho, o que ainda falta, e como rodar tudo localmente. É escrito para alguém que nunca viu o código, mas precisa entender o projeto inteiro — sem inflar o que foi feito nem esconder o que não funcionou.

---

## 1. Visão geral do projeto

**Chuvarada** é um PWA (Progressive Web App) que mostra, em tempo real e por bairro, o risco de alagamento em cidades do Nordeste do Brasil. O usuário abre o app, vê um mapa do Nordeste inteiro com bairros coloridos por nível de risco (verde/amarelo/vermelho), pode tocar em qualquer bairro pra ver o detalhamento do cálculo, a previsão do tempo hora a hora, e salvar bairros como favoritos pra acompanhar.

### O problema que resolve

O aquecimento global vem tornando eventos de chuva mais intensos e concentrados no tempo — o mesmo volume mensal de chuva que antes se distribuía ao longo de semanas hoje cai em poucas horas. Cidades do Nordeste brasileiro, com infraestrutura de drenagem urbana historicamente subdimensionada e datada, não foram projetadas pra esse regime de chuva mais extremo. O resultado são alagamentos cada vez mais frequentes e mais graves, muitas vezes em bairros onde o morador não tinha como saber que o risco estava subindo naquele momento específico.

Hoje, o cidadão comum não tem uma forma acessível e granular de saber "meu bairro está em risco agora?" — os alertas oficiais de Defesa Civil, quando existem, costumam ser por cidade ou por região inteira, não por bairro, e nem toda cidade do interior tem esse serviço ativo e atualizado. O Chuvarada tenta preencher esse vão: cruzar dados públicos (clima, terreno, hidrografia, maré) num modelo simples e transparente, atualizado a cada hora, granular o suficiente pra dizer "este bairro específico" em vez de "esta cidade inteira".

### Público-alvo

Cidadão comum, não especialista — alguém que quer decidir rapidamente "posso sair de casa agora?" ou "preciso me preocupar com este bairro que estou monitorando?". Por isso o app evita jargão técnico na interface (a página `/como-funciona` existe justamente pra explicar o modelo em linguagem simples pra quem quiser entender o "porquê" por trás da cor do mapa) e prioriza clareza visual sobre densidade de informação.

### Posicionamento

O Chuvarada se posiciona como **complemento** à informação pública, não como crítica ao poder público. A Defesa Civil, o INMET, a Marinha do Brasil (CPTEC) e o IBGE já produzem dados de excelente qualidade — o que falta, na maior parte das cidades, é alguém cruzando esses dados publicamente disponíveis num formato acessível e granular o bastante pra uso individual. O rodapé do app resume essa postura: *"O Chuvarada complementa a informação pública, colocando dados abertos do governo nas mãos do cidadão comum. Não é crítica ao poder público — é parceria."*

---

## 2. Stack tecnológico

| Camada | Tecnologia | Por quê |
|---|---|---|
| Frontend | **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS** | App Router permite misturar rotas de API (`app/api/`) e páginas no mesmo projeto sem precisar de um backend separado — importante pro cron de atualização de risco rodar como uma rota Next mesmo, sem infraestrutura extra. TypeScript pega erros de schema (ex: campo que existe em `WeatherCache` mas não foi propagado pra `NormalizedWeather`) em tempo de compilação, o que importa muito num modelo de risco onde um campo faltando silenciosamente vira um `undefined` que quebra o cálculo. |
| Mapa | **Leaflet.js** + tiles CartoDB Dark Matter | Leaflet é leve, não depende de chave de API paga (diferente do Google Maps/Mapbox em escala), e tem suporte maduro a polígonos GeoJSON — essencial já que cada bairro é desenhado como polígono real, não como marcador de ponto. O tile escuro (Dark Matter) combina com a paleta do app e reduz ruído visual, deixando as cores de risco dos bairros como o elemento visual dominante. |
| Animações | **Framer Motion** | Usado nas transições do painel de bairro, no coração de favorito, e nos banners — dá uma sensação de resposta mais viva sem exigir CSS keyframes manuais espalhados pelo código. |
| Gráficos | **Recharts** | Usado no histórico de score por bairro (`HistoryChart`) — biblioteca React-nativa, evita reimplementar eixos/tooltips/zonas de referência coloridas na mão. |
| Banco de dados | **Supabase** (Postgres gerenciado + Auth + Realtime + RLS) | Dá banco relacional de verdade (importante pro modelo de risco, que faz joins entre `neighborhoods`, `cities`, `risk_scores`), autenticação pronta (usada em `/auth` e favoritos), e um canal de **Realtime** que notifica o frontend assim que uma nova linha entra em `risk_scores` — sem isso, o mapa precisaria fazer polling manual a cada X segundos em vez de atualizar assim que o cron termina. |
| Acesso ao banco (server-side) | **`pg`** (Pool direto), não só o client JS do Supabase | As rotas de API (cron, scripts de backfill) escrevem em lote (`insertRiskScoresBatch`, `upload_state_expansion.js`) usando queries SQL diretas via `pg` — mais controle sobre performance de insert em massa (7.117 bairros) do que o client REST do Supabase permitiria com a mesma previsibilidade. |
| Clima em tempo real | **Open-Meteo** | Ver justificativa detalhada abaixo — trocou a OpenWeatherMap no meio do projeto (19/07) por uma limitação estrutural séria descoberta em produção. |
| Maré | **CPTEC/INPE** (scraping HTML da tábua de marés da Marinha do Brasil) | Não existe API pública de maré em tempo real gratuita cobrindo o Nordeste inteiro — a alternativa foi extrair a tábua de marés publicada pelo CPTEC (`lib/cptec.ts`, via `cheerio`), que é o dado oficial usado pela própria Marinha. |
| Pré-processamento geoespacial | **Python** (`geopandas`, `rasterio`, `shapely`, `pyogrio`) | Processar shapefiles do IBGE, GeoTIFFs de elevação (SRTM) e geopackages de hidrografia em escala nacional (a BHO/ANA tem 2,7 milhões de feições) exige ferramentas GIS maduras — não há equivalente prático em Node/TS pra esse volume de geoprocessamento. |
| PWA | **next-pwa** | Ver justificativa abaixo — app instalável sem passar por loja de aplicativo. |

### Por que Open-Meteo em vez de OpenWeatherMap

O projeto começou com **OpenWeatherMap** (commit inicial, 18/07). O problema descoberto depois (troca feita em **19/07**, commit `6f70d02`): o plano gratuito da OpenWeatherMap **não tem endpoint de histórico** — só previsão futura. Isso forçava `rain_72h` (chuva acumulada nas últimas 72 horas, 20% do peso do modelo) a ser calculado a partir do endpoint de *previsão* de 5 dias, o que é logicamente errado: chuva que já caiu e passou (ex: um fim de semana chuvoso seguido de uma segunda-feira seca) nunca aparecia no cálculo, porque a "previsão" não sabe o que já choveu.

A Open-Meteo, além de gratuita e sem exigir chave de API, tem o parâmetro `past_days` que devolve chuva **realmente observada** nas horas/dias anteriores — resolvendo esse problema de origem. A troca também teve um efeito colateral positivo de performance: o cron foi reescrito nessa mesma virada pra processar cidades em paralelo (antes era sequencial e levava horas pra 1.794 municípios).

### Por que Supabase Realtime

Sem um canal de atualização push, o mapa só saberia que um bairro mudou de risco fazendo polling — verificar a cada N segundos se há dado novo, desperdiçando requisições na maior parte do tempo (o cron só roda a cada hora). O Supabase Realtime assina mudanças na tabela `risk_scores` via replicação lógica do Postgres e empurra o evento direto pro cliente WebSocket already conectado — o mapa reage no instante em que o cron grava um novo score, sem esperar o próximo ciclo de polling.

### Por que PWA em vez de app nativo

Um PWA instala direto do navegador (sem loja de aplicativo, sem processo de aprovação, sem taxa de desenvolvedor), roda em iOS e Android com o mesmo código, e permite iteração rápida — importante pra um projto neste estágio, onde o modelo de risco e a cobertura de dados ainda estão evoluindo ativamente. O `manifest.json` (`background_color`, `theme_color`, ícones em 192/512px e a variante `maskable`) e o service worker gerado pelo `next-pwa` dão a experiência de "app instalado" (ícone na tela inicial, tela cheia) sem o custo de manter duas bases de código nativas (iOS + Android).

---

## 3. Fontes de dados — completo e honesto

### SRTM / NASA (altimetria)

- **O que fornece**: elevação do terreno, usada para calcular `terrain_slope` (declividade) por bairro — terreno mais plano acumula água com mais facilidade que terreno íngreme.
- **Como foi obtida**: GeoTIFFs SRTMGL1 baixados via [OpenTopography](https://portal.opentopography.org/) (portal.opentopography.org), um recorte por cidade nas primeiras 9 capitais, depois recortes estaduais maiores (Bahia, Pernambuco, Rio Grande do Norte, e depois os outros 6 estados) via `scripts/download_srtm_patch.js`.
- **Dificuldades**: a API do OpenTopography tem **cota de 50 chamadas/dia no plano gratuito**, que foi esgotada durante os testes — limitação externa, não um bug do projeto. Os arquivos estaduais grandes (Bahia mesclada chega a ~900MB) passam do limite de 100MB do GitHub e por isso **não são versionados** — ficam listados no `.gitignore` com instrução de como recriá-los.
- **Limitações**: resolução de ~30m (SRTMGL1) — suficiente pra declividade agregada por bairro, não pra microtopografia de rua.

### BHO/ANA (hidrografia nacional)

- **O que fornece**: cursos d'água (rios, canais, riachos) usados pra calcular `hydro_proximity` — quanto mais perto de um corpo d'água, maior o risco de transbordamento.
- **Órgão**: ANA (Agência Nacional de Águas), base BHO (Base Hidrográfica Ottocodificada).
- **URL**: `https://metadados.snirh.gov.br/files/32e309da-a8c1-443f-90ac-0cd79ce6a33d/geoft_bho_curso_dagua.gpkg`
- **Como foi obtida**: download direto de um GeoPackage nacional de **2,7GB** (2.751.685 feições, Brasil inteiro) — o recorte regional "Atlântico Nordeste Oriental" mencionado no plano original do projeto não existe mais nesse formato, então o pipeline precisou lidar com o arquivo nacional inteiro.
- **Dificuldade real**: baixar/processar 2,7GB parecia impraticável a princípio. A solução foi usar **bbox pushdown** no próprio `geopandas.read_file()` — o GDAL recorta o arquivo na leitura, sem carregar o Brasil inteiro em memória. O bbox usado (`NORDESTE_BBOX` em `scripts/process_bho.py`) cortava incorretamente as bordas do Nordeste real (oeste do Maranhão, sul da Bahia, litoral leste de João Pessoa e Fernando de Noronha) — corrigido em 19/07 (ver seção 7).
- **Limitação conhecida**: por ser um dado nacional generalista, tem menos detalhe em áreas urbanas densas do que um cadastro municipal de drenagem (ver Recife/Paraíba/Sergipe abaixo, que complementam a BHO com dado local onde disponível).

### IBGE Censo 2022 (malha de setores censitários/bairros)

- **O que fornece**: os polígonos de bairro (ou, na ausência de bairro nomeado, distrito administrativo) usados como unidade geográfica de todo o modelo.
- **URL**: `https://geoftp.ibge.gov.br/.../censo_2022/setores/shp/UF/` (shapefile por estado, todos os municípios juntos).
- **Como foi obtida**: download direto por estado (9 shapefiles, um por UF do Nordeste).
- **Dificuldades**: URLs desatualizadas em relação ao que o plano original do projeto previa (a estrutura de pastas do FTP do IBGE mudou); codificação mista UTF-8/Latin-1 nos atributos de nome de município/bairro entre estados, exigindo tratamento cuidadoso de encoding no `geopandas`.
- **Limitação estrutural importante**: o Censo 2022 só preenche `NM_BAIRRO` pra municípios que têm bairro oficialmente nomeado. Municípios pequenos do interior — muito comuns no Nordeste — não têm essa subdivisão, e o pipeline cai no distrito administrativo (`NM_DIST`) como aproximação geométrica. Isso significa que, em boa parte do interior, "o bairro X" no app é na prática **o distrito inteiro** (que pode ser bem maior que um bairro urbano de verdade) — ver números por estado na seção 6.

### CPTEC/INPE (tábua de marés via scraping)

- **O que fornece**: nível de maré normalizado (0 a 1), 8% do peso do modelo, aplicado só em municípios costeiros com estação de monitoramento próxima.
- **Órgão**: CPTEC/INPE, dado oficial da Marinha do Brasil.
- **URL**: `http://ondas.cptec.inpe.br/~rondas/mares/index.php?cod={codigo}&mes={mes}&ano={ano}`
- **Como foi obtida**: **scraping HTML** (`lib/cptec.ts`, via `cheerio`) — não existe API JSON pública para esse dado. O parser extrai uma tabela HTML de dia/hora/altura por estação.
- **Dificuldades encontradas**: (1) o site espera o ano com **2 dígitos**, não 4 — mandar "2026" faz o template do CPTEC concatenar errado e cair num fallback de mês vazio; (2) o domínio só responde de forma confiável em **HTTP puro**, não HTTPS moderno; (3) o catálogo de estações é limitado — só **~23 estações cobrem o Nordeste inteiro** (de 51 no Brasil todo), então a maior parte dos municípios costeiros não tem estação própria e precisou de atribuição por proximidade geográfica (ver seção 8).
- **Limitação conhecida**: sem dado publicado para meses futuros até o CPTEC divulgar (o cache trata isso como "miss" e tenta de novo, não fica travado).

### Open-Meteo (clima em tempo real e histórico 72h)

- **O que fornece**: chuva na última hora, chuva acumulada em 72h, pico de chuva nas últimas 3h, vento, umidade, pressão — o núcleo do modelo (65% do peso combinado entre as 3 variáveis de chuva).
- **URL**: `https://api.open-meteo.com/v1/forecast` — gratuita, sem chave de API.
- **Como foi obtida**: chamada HTTP direta por célula geográfica (grade de ~10km, não por cidade inteira — ver seção 4).
- **Dificuldades**: cota diária gratuita **esgotada em produção** no fim de semana de 18-19/07/2026, quando o cron rodou ~1.794 cidades repetidas vezes durante testes intensivos, retornando HTTP 429 (mesmo código de um rate-limit transitório, dificultando o diagnóstico — ver seção 7). Corrigido com contador interno de chamadas/hora, cache mais respeitado e um modo `WEATHER_CACHE_ONLY` pra desenvolvimento.
- **Limitação**: como qualquer API meteorológica, é uma estimativa de modelo numérico — não substitui um pluviômetro físico no bairro.

### Cemaden

- **Status**: apenas planejado, **não integrado**. O Cemaden (Centro Nacional de Monitoramento e Alertas de Desastres Naturais) foi cogitado como fonte de alerta oficial complementar, mas essa integração não chegou a ser implementada nesta fase do projeto.

### Defesa Civil / S2ID (histórico de ocorrências) — tentado, com limitações

- **O que é**: S2ID (Sistema Integrado de Informações sobre Desastres), Ministério da Integração Nacional — reconhecimentos oficiais de Situação de Emergência (SE) / Estado de Calamidade Pública (ECP) por decreto municipal.
- **Como foi processado**: `scripts/process_s2id.py` lê planilhas `.xls` anuais (2013-2016) de Salvador, Recife e Natal, detectando o cabeçalho dinamicamente (o layout mudou entre 2013-2015 e 2016).
- **Limitação séria encontrada**: a granularidade do S2ID é **por município**, não por bairro — não dá pra validar o modelo de risco (que é por bairro) diretamente contra esses eventos. Além disso, não havia eventos de alagamento datados suficientes no período coberto pra servir de base de validação estatística robusta. Essa foi uma tentativa que **não deu no resultado esperado** (ver seção 9).

### Hidrografia do Recife (Secretaria de Meio Ambiente)

- **O que fornece**: faixas marginais de proteção dos recursos hídricos do Recife — mais preciso que a BHO nacional pra uso urbano dentro da cidade.
- **URL**: portal de dados abertos do Recife, descoberto via busca na API do CKAN (o dataset citado no plano original do projeto, `recursos_hidricos.geojson`, não existe mais nesse portal — foi encontrado um equivalente, `faixas-marginais-dos-recursos-hidricos.geojson`).
- **Como foi processado**: `scripts/process_hydro_recife.py` mescla o dado municipal com a BHO regional, dando prioridade ao dado local onde ele existe e completando com a BHO só numa vizinhança de ~11km ao redor (sem esse limite, o arquivo de saída incluiria os ~240 mil trechos de rio de todo o Nordeste, gerando ~150MB pra uma cidade só).

### Hidrografia da Paraíba / AESA

- **Órgão**: AESA (Agência Executiva de Gestão das Águas do Estado da Paraíba).
- **URL**: `https://geoportal.aesa.pb.gov.br/arquivos/arquivos-shapefiles/`
- **Status**: dado baixado (`scripts/06ed293`/`5e54b97`, commitado como dado bruto não processado) — shapefiles de bacias hidrográficas, drenagem principal e sub-bacias da Paraíba. Ainda não integrado ao cálculo final de `hydro_proximity` (fica como melhoria de precisão futura, já que a PB já tem 100% de `hydro_proximity` real via BHO).

### Hidrografia de Sergipe / SERhidro

- **Órgão**: SEMAC/SERhidro (geoportal estadual lançado em 2024).
- **URL**: `https://serhidro.semac.se.gov.br/datasets/hidrografia-sergipe`
- **Status**: **integrado**. `scripts/process_hydro_sergipe.py` combina o dado local do SERhidro/SEMARH com a BHO nacional — importante: em vez de **substituir** a BHO pelo dado local (o que seria uma regressão, já que a SEMARH tem menos cobertura de riachos intermitentes que a BHO), o script faz `max()` entre os dois por bairro, aproveitando o melhor dos dois onde cada um for mais denso (ver seção 9).

### Hidrografia de Alagoas / SEPLAG

- **Órgão**: SEPLAG-AL ("Alagoas Geográfico") e `dados.al.gov.br` (dataset de recursos hídricos e bacias de Alagoas).
- **Status**: **pesquisado, não baixado** — Alagoas já tem 100% de `hydro_proximity` real via BHO nacional (0 bairros com valor zero), então essa fonte ficou como upgrade de precisão de baixa prioridade, não corretiva.

### Shapefiles de bairros das capitais

| Capital | Fonte | Status |
|---|---|---|
| Aracaju (SE) | MapAju / SIUGWEB | **Obtido** — geoportal oficial ativo, exportação direta |
| Maceió (AL) | Observatório da Cidade (IPLAM) / dados.al.gov.br | **Obtido** (dado bruto baixado, não processado) |
| São Luís (MA) | GISMaps (redistribui dado da prefeitura) | **Baixado, com limitação de acesso** — ver seção 9 |
| Teresina (PI) | SEMPLAN (portal oficial) | **Tentado, bloqueado** — portal protegido por WAF/JS impediu automação |
| João Pessoa (PB) | Filipeia / geo.joaopessoa.pb.gov.br | **Tentado, bloqueado** — mesma limitação (WAF/JS) |

### OpenTopography (SRTM via API, limitações de cota)

Já descrito na seção de SRTM acima — cota de **50 chamadas/dia** no plano gratuito, esgotada durante os testes de expansão estadual. Contornado processando por lotes menores ao longo de vários dias.

---

## 4. Pipeline de dados — do dado bruto ao mapa

### 1. Download dos dados brutos
Scripts e comandos manuais (`wget`, downloads diretos de portal) trazem shapefiles do IBGE, GeoTIFFs do OpenTopography, o geopackage da BHO/ANA, e hidrografias locais (Recife, Paraíba, Sergipe) para `dados-brutos/` (fora do controle de versão para os arquivos grandes — ver `.gitignore`).

### 2. Pré-processamento Python
Ordem real de execução (documentada em `process_neighborhoods.py`):
1. **`process_neighborhoods.py`** (ou `process_state_neighborhoods.py`, variante para estado inteiro) — dissolve os setores censitários do IBGE em polígonos por bairro, marca `is_coastal`, exporta GeoJSON com `terrain_slope`/`hydro_proximity` como placeholder.
2. **`process_srtm.py`** — abre o GeoTIFF, calcula declividade (gradiente do DEM em graus), agrega por bairro (média dentro do polígono) e preenche `terrain_slope` de verdade *in-place* no mesmo GeoJSON. Tem um modo "por janela" (`aggregate_by_neighborhood_windowed`) para estados inteiros, evitando carregar um raster de vários GB em memória de uma vez.
3. **`process_bho.py`** — recorta a hidrografia nacional pelo bbox do Nordeste, calcula a distância de cada bairro ao curso d'água mais próximo, normaliza (`0` = >5km, `1` = <500m) e preenche `hydro_proximity`.
4. **`process_hydro_recife.py`** / **`process_hydro_sergipe.py`** — refinam `hydro_proximity` com dado hidrográfico municipal/estadual mais preciso onde disponível, combinando com a BHO (nunca substituindo integralmente).

Scripts complementares: `process_s2id.py` (eventos históricos de desastre), `process_inmet_extremes.py` (dias de chuva extrema por estação INMET), `compute_slope_for_geometries.py` (recálculo pontual de declividade para correções).

### 3. Upload pro Supabase
`upload_neighborhoods.js` e `upload_state_expansion.js` leem os GeoJSONs processados e inserem em lote nas tabelas `cities`/`neighborhoods` via `pg` direto (não o client REST do Supabase, por performance em volume). Scripts de correção pontual (`fix_sao_luis_neighborhood.js`, `fix_areia_branca_tide_code.js`, `fix_terrain_slope_placeholders.js`, `assign_tide_by_proximity.js`, `fix_hydro_proximity_bbox.js`, `fix_hydro_sergipe_local.js`, `fix_fernando_de_noronha_tide.js`, `backfill_terrain_slope.js`, `backfill_name_source.js`) tratam problemas descobertos depois do upload inicial (ver seção 7).

### 4. Cron de 1 hora (fluxo detalhado)
`app/api/cron/update/route.ts`, protegido por `CRON_SECRET` no header `Authorization`:
1. Busca todas as `cities` ativas (1.794) e todos os `neighborhoods` (7.117).
2. Agrupa os bairros de cada cidade por **célula geográfica** (grade de ~10km, `lib/grid.ts`) — bairros próximos dentro da mesma célula reaproveitam a mesma chamada de clima, em vez de 1 chamada por bairro (que geraria dezenas de milhares de chamadas desnecessárias) ou 1 chamada por cidade inteira (que perderia a variação real de chuva dentro de cidades grandes).
3. Para cada célula, busca o clima (`getWeatherForPoint`, com cache de 20 minutos e fallback pra dado em cache se a chamada nova falhar).
4. Busca o nível de maré atual (`getCurrentTideLevel`) para cidades com `tide_code`.
5. Calcula o score de cada bairro (`calculateScore`, ver seção 5).
6. Insere os resultados em lote em `risk_scores` e sincroniza `risk_events` (início/fim de um período em determinado nível).
7. Cidades são processadas em paralelo (4 por vez), e dentro de cada cidade, células também em paralelo (4 por vez) — teto de concorrência calibrado para não estourar o rate limit do Open-Meteo.

### 5. Cálculo do score por bairro
Ver seção 5 completa abaixo.

### 6. Supabase Realtime → atualização do mapa
Assim que a linha nova entra em `risk_scores`, o Supabase Realtime (assinatura via `hooks/useRealtime.ts`) empurra o evento pro cliente conectado, que atualiza a cor do bairro no mapa sem precisar recarregar a página ou fazer polling.

---

## 5. Modelo de risco — explicação técnica completa

O cálculo (`lib/score.ts`) é uma soma ponderada de 6 variáveis, cada uma normalizada entre 0 e 1:

| Variável | Peso | Normalização |
|---|---:|---|
| `rain_peak_3h` — maior chuva horária nas últimas 3h | 25% | linear: 0mm/h→0, 10mm/h→0,5, 30mm/h→1,0 |
| `rain_1h` — chuva na última hora | 20% | linear: 0mm→0, 25mm→0,5, 50mm→1,0 |
| `rain_72h` — chuva acumulada em 72h | 20% | linear: 0mm→0, 50mm→0,5, 100mm→1,0 |
| `terrain_slope` — declividade do terreno | 15% | já normalizado no pré-processamento (0=plano/maior risco, 1=íngreme/menor risco) |
| `hydro_proximity` — proximidade a rio/canal | 12% | já normalizado no pré-processamento (0=longe, 1=perto) |
| `tide_level` — nível de maré | 8% | 0 a 1, só quando o município tem `tide_code` |

A função `normalizeLinear(value, mid, max)` usa o ponto médio como referência de 0,5 (interpolação linear em dois trechos), não uma reta única de 0 a max — isso dá mais sensibilidade na faixa "moderada" da variável.

### Por que `rain_peak_3h` em vez de `rain_intensity`

Até 19/07, a variável de intensidade de chuva (`rain_intensity`) capturava só **o valor exato do instante em que o cron rodava**. Um pico de chuva forte que dura menos que os 20 minutos entre execuções do cron (bem comum em chuva convectiva tropical) passava completamente despercebido — o cron podia rodar 5 minutos depois do pico parar e nunca "ver" aquela chuva forte. `rain_peak_3h` resolve isso pegando o **máximo** valor horário dentro das últimas 3 horas, não só o instante atual — um pico que já passou ainda pesa no risco.

### Limiares atuais (0,30 / 0,60) e por que foram ajustados

```
Normal:    0,00 – 0,30
Atenção:   0,30 – 0,60
Crítico:   0,60 – 1,00
```

Até 19/07, os limiares eram 0,40/0,70. Um evento real de chuva em Recife no fim de semana de 18-19/07 (bairro Nova Descoberta, `rain_72h = 56,74mm`) gerou score **0,380** — abaixo do limiar antigo de 0,4, ou seja, ficou classificado como "normal" apesar de já ter uma quantidade de chuva acumulada significativa. Os limiares foram recalibrados para 0,30/0,60 depois desse achado — com o novo limiar, o mesmo bairro passa a "atenção".

### As 3 regras de crítico automático

Independente do score ponderado, o bairro entra direto em **crítico** se qualquer uma destas condições for verdadeira:
1. `rain_1h > 50mm` — chuva extrema na última hora.
2. `tide_level > 0,8` **e** `rain_3h > 20mm` **e** o bairro é costeiro **e** o município tem estação de maré — maré alta reduzindo a capacidade de escoamento durante chuva em zona costeira.
3. `rain_72h > 100mm` **e** `rain_1h > 0` — solo já saturado recebendo qualquer chuva nova.

### Maré condicional e peso redistribuído

A variável de maré só entra no cálculo em municípios com `tide_code` cadastrado (estação CPTEC próxima o suficiente para servir de referência confiável). Em municípios sem `tide_code`, o app **não** usa um valor "neutro" de 0,5 fingindo dado — isso distorceria o score artificialmente. Em vez disso, o peso de 8% da maré é redistribuído proporcionalmente entre as 5 variáveis restantes, mantendo a soma em 1,0.

### Limitações honestas do modelo

O Chuvarada **não tem dado de bueiros e galerias pluviais** — essa informação não está disponível publicamente em nenhuma capital nordestina mapeada nesta pesquisa. Por isso o modelo usa hidrografia natural (rios, canais, córregos) e declividade do terreno como aproximação da capacidade de escoamento urbano real. O modelo é deliberadamente conservador: prefere alertar quando o risco real pode ser menor do que silenciar quando o risco é real.

---

## 6. Cobertura geográfica

Números atuais (verificados diretamente no banco em 19/07/2026):

| Métrica | Valor |
|---|---:|
| Estados cobertos | **9** (todo o Nordeste: AL, BA, CE, MA, PB, PE, PI, RN, SE) |
| Municípios cadastrados | **1.794** (100% dos municípios IBGE do Nordeste) |
| Municípios com ao menos 1 bairro | **1.794** (100%) |
| Bairros/distritos no total | **7.117** |
| Bairros com `terrain_slope` real (sem placeholder) | **7.117** (100%) |
| Bairros com `hydro_proximity` computado (>0) | **7.001** (98,4%) |
| Bairros com score de risco calculado | **7.117** (100%) |
| Municípios costeiros | **171** |
| Municípios costeiros com `tide_code` | **91** (53,2%) |
| Eventos históricos importados | **55** (precipitação extrema, INMET, Salvador/Recife/Natal) |

### Por estado

| Estado | Municípios | Bairros | `hydro_proximity=0` | Nome de bairro real |
|---|---:|---:|---:|---:|
| AL | 102 | 240 | 0 | 52,1% |
| BA | 417 | 1.306 | 103 | 34,8% |
| CE | 184 | 2.197 | 5 | 59,6% |
| MA | 217 | 415 | 5 | 41,4% |
| PB | 223 | 551 | 0 | 46,6% |
| PE | 185 | 1.056 | 2 | 62,4% |
| PI | 224 | 702 | 1 | 68,2% |
| RN | 167 | 375 | 0 | 49,3% |
| SE | 75 | 275 | 0 | 65,5% |

### Nível de dado por cidade (`data_level`)

| Nível | Cidades | O que significa |
|---|---:|---|
| `full` | 3 | Salvador, Recife, Natal — modelo completo com hidrografia municipal refinada |
| `partial` | 31 | Capitais e cidades grandes com hidrografia regional (BHO) mas sem dado municipal dedicado |
| `minimal` | 1.760 | Modelo baseado em clima, terreno e hidrografia regional — sem refinamento local |

### Cobertura de maré

171 municípios costeiros, dos quais **91 têm `tide_code`** — a maioria por atribuição da estação CPTEC mais próxima (o catálogo real tem só ~23 estações cobrindo todo o litoral nordestino, então várias cidades vizinhas compartilham legitimamente o código da estação mais próxima). Municípios a mais de 80km de qualquer estação foram deixados **sem** `tide_code` deliberadamente — um dado de baixa confiança seria pior que a ausência de dado (ver seção 8).

### Os 3 níveis de "empty state"

O mapa nunca esconde uma área sem cobertura completa — em vez disso, sinaliza o nível real de dado disponível:
1. **Bairro real com score calculado** — polígono colorido normalmente pelo nível de risco.
2. **Bairro com nome de fallback** (distrito/setor, não bairro nomeado no Censo) — ainda mostra o score, mas o nome exibido é honesto sobre a granularidade real (`hasRealName()` em `lib/neighborhoodName.ts` sinaliza isso para a UI).
3. **Município sem nenhum bairro processado ainda** (hoje: nenhum — o único caso, São Luís, foi corrigido em 19/07) — mostraria o contorno municipal real do IBGE em cinza, com tooltip "Cobertura em expansão", em vez de um marcador de ponto solto ou simplesmente omitir a área do mapa (`components/map/EmptyStateLayer.tsx`).

---

## 7. Dificuldades encontradas — cronologia honesta

### Dados

- **URLs desatualizadas nas fontes originais** — o FTP do IBGE, o portal da ANA e o portal de dados abertos do Recife mudaram de estrutura em relação ao que o plano original do projeto previa; cada uma exigiu buscar o dataset equivalente atual antes de baixar.
- **Geopackage de 2,7GB da ANA** — parecia impraticável baixar/processar por inteiro; resolvido com bbox pushdown no `geopandas.read_file()`.
- **`NORDESTE_BBOX` cortando municípios nas bordas dos estados** — descoberto no diagnóstico de 19/07: o bbox original (`-45,0 / -15,0 / -35,0 / -1,0`) cortava o oeste do Maranhão, o sul da Bahia, e a borda leste (Fernando de Noronha e o litoral da própria capital João Pessoa). Corrigido alargando para `(-49,5 / -19,0 / -31,5 / -1,5)` e reprocessando.
- **Codificação mista UTF-8/Latin-1 nos shapefiles do IBGE** — nomes de município/bairro com acentuação exigiram tratamento cuidadoso de encoding entre estados diferentes.
- **Litoral subestimado por usar centroide em vez de polígono inteiro** — a marcação `is_coastal` mede a distância do **centroide** do bairro até a linha de costa; bairros grandes que só encostam a costa numa ponta podem ser sub ou super-representados. Ficou como aproximação aceita, não corrigida.
- **Colisão de nomes entre municípios homônimos de estados diferentes** — `Areia Branca` existe tanto no RN (costeiro) quanto em SE (interior, não-costeiro); o mapa de códigos de maré (`TIDE_CODE_OVERRIDES`, indexado só por nome) atribuiu o código do RN também ao de SE por engano. Corrigido trocando a chave para `nome::estado`.
- **São Luís sem bairro por bug silencioso de skip no upload** — São Luís já existia em `cities` (de uma tentativa anterior que não completou o processamento), então quando o Maranhão inteiro foi processado depois, o script de upload pulou São Luís silenciosamente por já "existir", sem checar se ela de fato tinha bairros. Corrigido inserindo o dado (já processado e correto) que tinha sido descartado.
- **`tide_code` duplicado entre Areia Branca/RN e Areia Branca/SE** — mesma causa raiz da colisão de nomes acima.
- **8 bairros com `terrain_slope` placeholder** (Fernando de Noronha/PE, alguns em RN) — nomes de bairro que não bateram entre o geojson processado e a tabela `cities` no momento do backfill; corrigidos recalculando via SRTM diretamente pelas coordenadas.
- **CPTEC sem dado de julho/2026 em alguns momentos** — limitação externa (a tábua de maré de um mês futuro só é publicada perto da data); tratado como cache miss recuperável, não erro permanente.
- **OpenTopography com cota de 50 chamadas/dia esgotada durante testes** — contornado processando em lotes menores ao longo de vários dias.

### Frontend

- **`leaflet.css` não importado causando mapa em branco** — o CSS oficial do Leaflet não estava sendo carregado, fazendo o mapa renderizar sem nenhum tile visível. Corrigido logo no início (commit `aded496`, mesmo dia do setup inicial).
- **Commits com autor errado** — e-mail de commit não verificado no GitHub numa fase inicial; ajustado.
- **Previsão idêntica em todos os bairros** — o painel de previsão usava o centroide da **cidade**, não do bairro específico selecionado, fazendo bairros diferentes da mesma cidade mostrarem exatamente a mesma previsão. Corrigido buscando por célula geográfica do bairro.
- **Card de alerta nunca mostrava dados de clima** — a condição que decidia mostrar o `AlertCard` dependia de um estado (`selected`) que, quando `null` (nenhum bairro selecionado — justamente quando o card aparece), fazia a variável de clima do card nunca ser preenchida. Corrigido usando um bairro de referência fixo para os dados de clima do card, consistente com o que abre ao clicar nele.

### Modelo

- **`rain_72h` usando previsão futura da OpenWeatherMap em vez de histórico observado** — causa raiz do "mapa sempre verde" percebido no fim de semana de 18-19/07: chuva que já tinha caído e passado nunca entrava no cálculo. Resolvido trocando para Open-Meteo (que tem endpoint de histórico real).
- **`rain_intensity` capturando só o instante atual** — picos de chuva entre execuções do cron (20 minutos) passavam despercebidos. Resolvido com `rain_peak_3h` (máximo das últimas 3h, não o valor pontual).
- **Limiares conservadores demais** — 56,74mm/72h em Recife ficou classificado como "normal" (score 0,380, abaixo do limiar antigo de 0,4). Ajustado de 0,40/0,70 para 0,30/0,60.
- **Cron impraticável na escala de 7.117 bairros com processamento sequencial** — reescrito para processar cidades em paralelo (4 por vez) com agrupamento por célula geográfica e inserts em lote, em vez de bairro por bairro sequencial.
- **Rate limit da Open-Meteo esgotado durante sessão de testes intensivos** — o cron rodou ~1.794 cidades repetidas vezes num curto período, esgotando a cota diária gratuita (retornando HTTP 429, indistinguível por status code de um rate-limit transitório — o backoff exponencial existente não ajuda contra uma cota que só reseta no dia seguinte). Corrigido com um contador interno de chamadas/hora (pausa e loga aviso antes de bater na cota real), fallback para cache expirado quando a chamada nova falha, e um modo `WEATHER_CACHE_ONLY=true` para desenvolvimento.

### Fontes de dados

- **GISMaps bloqueando download automático** — portal usado por algumas prefeituras (ex: São Luís) tem um gate comercial que impede automação direta via `wget`.
- **Portais com JS/WAF impedindo download automatizado** — Filipeia/João Pessoa e SEMPLAN/Teresina têm proteção que bloqueia requisições automatizadas simples; exigiria navegador real ou acesso manual.
- **SERhidro (Sergipe) em ArcGIS Hub** — parte dos dados só carrega via JavaScript executado no navegador, não em requisição HTTP direta.
- **IPECE (Ceará) inacessível** — geoportal com hidrografia local de maior precisão não pôde ser baixado nesta pesquisa.
- **S2ID sem eventos de alagamento datados suficientes para BA/PE/RN no período coberto** — limitou a validação histórica do modelo (ver seção 9).
- **Substituição direta da hidrografia local de Sergipe seria uma regressão** — a base estadual (SEMARH) é mais esparsa em riachos intermitentes que a BHO nacional; resolvido combinando as duas com `max()` por bairro, em vez de substituir uma pela outra.

---

## 8. Decisões de produto tomadas ao longo do desenvolvimento

- **Granularidade por bairro, não por grid fixo** — mostrar risco por bairro real (mesmo quando o "bairro" é na prática um distrito, ver seção 6) é mais intuitivo pro usuário do que uma grade arbitrária de células, mesmo custando mais trabalho de pré-processamento geoespacial.
- **PWA em vez de app nativo** — ver justificativa completa na seção 2.
- **Mapa abre no Nordeste inteiro, dados carregam por viewport** — em vez de forçar o usuário a escolher uma cidade primeiro, o app já mostra o panorama regional de cara, com o usuário podendo pedir localização ou navegar livremente.
- **Empty states por nível de dado, não ocultar áreas sem cobertura** — uma área sem bairro processado ainda aparece no mapa com um estado visual claro ("cobertura em expansão"), em vez de simplesmente não existir visualmente, o que poderia ser confundido com "sem risco".
- **Bairros sem nome real exibidos de forma transparente** — em vez de fingir que um distrito é um bairro nomeado, o app sinaliza a diferença (`lib/neighborhoodName.ts`), sendo honesto sobre a granularidade real do dado que o usuário está vendo.
- **Maré condicional, peso redistribuído sem estação** — em vez de usar um valor neutro fingindo dado onde não existe estação de maré, o peso é redistribuído entre as demais variáveis (ver seção 5).
- **Open-Meteo em vez de OpenWeatherMap** (histórico observado vs. previsão) — decisão tomada depois de identificar a limitação estrutural do plano gratuito da OpenWeatherMap (seção 3).
- **Limiares ajustados após evento real de chuva** — a recalibração de 0,40/0,70 para 0,30/0,60 não foi teórica, foi motivada por um caso real observado em produção (Nova Descoberta/Recife).
- **Não atribuir `tide_code` para municípios a mais de 80km de qualquer estação** — atribuir maré por proximidade é uma aproximação razoável até certa distância; além disso, o dado se torna enganoso, e a decisão foi deixar sem `tide_code` (e portanto sem a variável de maré) em vez de forçar um valor de baixa confiança.
- **Combinar hidrografia local + BHO com `max()` em vez de substituir** — evita que um dado estadual mais esparso em algumas áreas (mas mais preciso em outras) piore a cobertura geral.
- **Posicionamento como parceiro do poder público, não crítico** — decisão de tom e comunicação, refletida no rodapé do app e na página `/como-funciona`.

---

## 9. O que foi tentado e não funcionou

- **Validação histórica com S2ID** — a granularidade por município (não por bairro) e a escassez de eventos de alagamento datados no período coberto impediram uma validação estatística robusta do modelo contra ocorrências reais. A tabela `historical_events` existe e tem 55 eventos importados (via INMET, precipitação extrema por estação), mas isso é diferente de uma validação ponta-a-ponta do score de risco contra desastres confirmados por bairro.
- **Download automático de shapefiles de bairro via `wget`** — funcionou para Aracaju (MapAju) e parcialmente para Maceió, mas falhou para Teresina e João Pessoa por proteção WAF/JS nos respectivos portais municipais.
- **Hidrografia local do Ceará via IPECE** — geoportal identificado como fonte de melhor precisão, mas inacessível para download nesta pesquisa.
- **Substituição direta da hidrografia de Sergipe** — testado e descartado por ser uma regressão de cobertura (ver seção 7); resolvido com combinação em vez de substituição.
- **Atribuição de `tide_code` de baixa confiança (>80km)** — calculado, mas deliberadamente **não aplicado** — decisão consciente de que a ausência de dado é mais honesta que uma aproximação ruim.

---

## 10. O que ainda falta

- **Deploy** — combinado como fase futura (Netlify cogitado), ainda não realizado.
- **Domínio** — não adquirido/configurado ainda.
- **Shapefiles de bairro de São Luís, Teresina, João Pessoa** — bloqueados por proteção de portal (GISMaps/WAF); precisam de download manual ou acesso alternativo.
- **Hidrografia local do Ceará** — IPECE inacessível nesta pesquisa; pendente de nova tentativa ou contato direto com o órgão.
- **Hidrografia local de Sergipe com granularidade maior** — o que existe já está integrado (combinado com BHO), mas há espaço de precisão adicional não explorado.
- **Validação histórica do modelo** — tabela criada e populada com dados INMET, mas sem uma validação estatística ponta-a-ponta do score contra eventos reais confirmados por bairro (ver seção 9).
- **Documentação final no Notion** — planejada como fase pós-desenvolvimento, ainda não feita.
- **Notificações push** — a tabela `notifications` já existe no schema (seção 11), mas não há UI nem lógica de envio implementada.
- **Autenticação e favoritos** — ao contrário do item acima, esta parte está **implementada e funcional**: `useAuth`, página `/auth` (login/cadastro por e-mail e senha), coração de favorito no painel de bairro, página `/favoritos`, e abertura do app centralizada no bairro favoritado mais recentemente para usuários autenticados.

---

## 11. Estrutura do repositório

```
app/                        Rotas Next.js (App Router)
├── api/
│   ├── cron/update/         Cron principal — recalcula risco de todos os bairros
│   ├── forecast/            Previsão do tempo (atual + 12h) por coordenada
│   ├── score/                Score de risco por bairro
│   ├── tide/                 Nível de maré por cidade
│   └── weather/               Clima bruto por coordenada
├── auth/                     Página de login/cadastro
├── favoritos/                 Página de bairros salvos
├── como-funciona/              Explicação do modelo em linguagem simples
└── page.tsx                    Página principal (mapa)

components/
├── map/                       MapContainer, NeighborhoodLayer, EmptyStateLayer, LocationButton
├── panel/                      DetailPanel, ScoreBreakdown, ForecastStrip, HistoryChart
├── ui/                         AlertCard, CityHeader, MapLegend, InfoButton/Modal, WeatherIcons, etc.
└── how-it-works/                RiskDiagram, VariableCard, SourcesList (usados em /como-funciona)

lib/                           Integrações e motor de risco
├── score.ts                    Cálculo do score de risco (motor principal)
├── weather.ts                   Integração Open-Meteo (com cache e rate limiting)
├── cptec.ts                      Integração CPTEC (maré, via scraping)
├── db.ts                          Pool de conexão Postgres direta
├── supabase.ts                    Client Supabase (Auth, Realtime)
├── grid.ts                         Agrupamento geográfico em células (~10km)
├── geojson.ts                      Utilitários de geometria (localizar bairro por ponto)
├── neighborhoodName.ts              Lógica de nome real vs. fallback
└── metricInfo.ts                     Textos explicativos das métricas (botões de "?")

hooks/                          useAuth, useFavorites, useForecast, useMap, useRealtime, useRisk, useLocation, useIsDesktop

scripts/                        Pré-processamento Python + upload + diagnósticos
├── process_neighborhoods.py       Setores censitários → polígonos de bairro (por cidade)
├── process_state_neighborhoods.py  Variante para estado inteiro
├── process_srtm.py                  SRTM → terrain_slope
├── process_bho.py                    BHO/ANA → hydro_proximity (nacional)
├── process_hydro_recife.py            Hidrografia municipal do Recife (refinamento local)
├── process_hydro_sergipe.py            Hidrografia estadual de Sergipe (refinamento local)
├── process_s2id.py                      Eventos de desastre S2ID (Defesa Civil)
├── process_inmet_extremes.py             Dias de chuva extrema (INMET)
├── upload_neighborhoods.js / upload_state_expansion.js   Upload em lote pro Supabase
├── fix_*.js / backfill_*.js               Correções pontuais pós-upload
├── assign_tide_by_proximity.js             Atribuição de tide_code por distância
├── generate_icons.js                        Gera os ícones PNG do PWA a partir de public/icon*.svg
└── sql/                                       Migrações numeradas (001 a 012)

public/geojson/                 Dados processados (28 arquivos) servidos estaticamente ao frontend
dados-brutos/                   Dados brutos baixados (fora do git para os arquivos grandes — ver .gitignore)
```

---

## 12. Como rodar o projeto localmente

### Pré-requisitos
- Node.js e npm
- Python 3 com `geopandas`, `rasterio`, `shapely`, `pyogrio` (só necessário para rodar os scripts de pré-processamento geoespacial, não para rodar o app em si)
- Uma instância Supabase (projeto criado, com as migrações de `scripts/sql/` aplicadas em ordem)

### Variáveis de ambiente (`.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_DB_PASSWORD=
SUPABASE_CONNECTION_STRING=
CRON_SECRET=
OPENTOPOGRAPHY_API_KEY=

# Opcional — modo de desenvolvimento
WEATHER_CACHE_ONLY=false
```

`WEATHER_CACHE_ONLY=true` força o app a usar sempre o `weather_cache` já existente (mesmo expirado) em vez de chamar o Open-Meteo — útil para testar sem consumir a cota diária gratuita.

### Instalar e rodar
```bash
npm install
npm run dev
```
Abre em `http://localhost:3000`.

### Rodar os scripts de pré-processamento
```bash
# Exemplo: processar bairros de uma cidade
python scripts/process_neighborhoods.py \
  --input dados-brutos/ibge/pe/PE_setores_CD2022.shp \
  --municipality Recife --city-name Recife --city-id <uuid>

# Depois, preencher terrain_slope e hydro_proximity in-place no mesmo GeoJSON
python scripts/process_srtm.py --input dados-brutos/srtm/srtm_recife.tif --city recife \
  --neighborhoods public/geojson/neighborhoods_recife.geojson

python scripts/process_bho.py --input dados-brutos/ana/geoft_bho_curso_dagua.gpkg \
  --neighborhoods public/geojson/neighborhoods_recife.geojson
```

### Forçar o cron manualmente
```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/update
```
Isso recalcula o score de risco de todos os 7.117 bairros — pode levar alguns minutos e consome a cota do Open-Meteo (usar `WEATHER_CACHE_ONLY=true` para testar sem gastar cota).

---

*Relatório gerado a partir do estado real do código, banco de dados e histórico de commits do repositório em 19/07/2026.*
