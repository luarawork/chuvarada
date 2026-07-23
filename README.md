# Chuvarada 🌧️

Mapa de risco de alagamento em tempo real para o Brasil.
Civic tech com personalidade — confiável mas humano.

## O que é

O Chuvarada cruza dados públicos de clima, terreno, hidrografia e maré para estimar, em tempo real e por bairro, o risco de alagamento em cidades brasileiras. Atualizado a cada hora. Sem jargão técnico na interface. Feito para o cidadão comum, não para especialistas.

O aquecimento global vem tornando eventos de chuva mais intensos e concentrados no tempo. Cidades brasileiras, com infraestrutura de drenagem historicamente subdimensionada, não foram projetadas para esse regime de chuva mais extremo. O Chuvarada tenta preencher o vão entre os alertas oficiais (por cidade ou região) e a pergunta real do cidadão: meu bairro está em risco agora?

## Cobertura atual

| Métrica | Valor |
|---|---|
| Estados | 27 (Brasil inteiro) |
| Municípios | 5.570 (100% dos municípios IBGE) |
| Bairros/distritos/subdistritos | 28.483 |
| Com score calculado | 4.653 de 5.570 (83,5%) — Centro-Oeste e Norte aguardam o 1º ciclo completo do cron (ver limitação de rate-limit abaixo) |
| Municípios costeiros com dado de maré cadastrado | 115 de 312 (36,9%) |

## Como funciona

O modelo calcula um score de 0 a 1 para cada bairro, combinando 6 variáveis:

| Variável | Peso | Fonte |
|---|---:|---|
| Pico de chuva nas últimas 3h | 25% | MERGE/CPTEC |
| Chuva na última hora | 20% | Open-Meteo |
| Chuva acumulada em 72h | 20% | MERGE/CPTEC |
| Declividade do terreno | 15% | NASA SRTM |
| Proximidade de rios/canais | 12% | ANA/BHO + hidrografia local |
| Nível de maré | 8% | Marinha do Brasil via CPTEC |

Níveis de risco:
- 🟢 Normal: score < 0,30
- 🟡 Atenção: score 0,30 – 0,60
- 🔴 Crítico: score > 0,60

Além do score, 3 regras disparam nível crítico automaticamente:
- Chuva > 50mm na última hora
- Maré alta (>80%) + chuva em zona costeira (só com dado de maré recente, <26h)
- Solo saturado (>100mm/72h) + qualquer chuva nova

Para municípios sem estação de maré próxima (>80km), o peso de 8% da maré é redistribuído proporcionalmente entre as demais variáveis.

Abaixo do zoom 10, o mapa mostra 1 ponto por cidade (colorido pelo pior nível entre seus bairros) em vez de polígonos — ilegíveis nessa escala e caros de carregar num viewport largo.

## Limitações conhecidas

- **Maré**: a fonte CPTEC está fora do ar — confirmado que não é mudança de layout, a tábua vem vazia para qualquer estação/mês/ano testado, e o webservice alternativo da Marinha foi descontinuado em 2018. Até essa fonte ser restaurada ou substituída, `tide_level` fica sempre neutro (0,5) em todo o país (ver `lib/cptec.ts`).
- **São Paulo, Campinas e Sorocaba**: usam distrito administrativo em vez de bairro — o Censo 2022 do IBGE não tem `NM_BAIRRO` pra essas cidades (confirmado também no GeoSampa, portal da própria Prefeitura de SP). Afeta ~46% dos registros nacionais no total, mais concentrado no interior.
- **Amazônia (AM, PA, RR, AP, AC, RO, parte de MT)**: o modelo é projetado para alagamento urbano por chuva intensa, não captura cheias sazonais de rio (padrão amazônico de subida/descida do nível dos grandes rios ao longo do ano) — `data_level='minimal'` nesses estados reflete essa limitação, não falta de bairros.
- **SRTM em floresta densa**: a elevação medida pelo satélite inclui o topo do dossel da vegetação, não o solo — infla a elevação aparente do terreno e pode subestimar a declividade real em áreas de mata fechada (Norte principalmente). Limitação conhecida da fonte, não corrigida nesta expansão.
- **Rate-limit do Open-Meteo em atualização em massa**: quando o `weather_cache` expira por completo pro país inteiro de uma vez (ex: após um período longo sem o cron rodar), o pico de demanda simultânea excede o limite do plano gratuito do Open-Meteo, forçando fallback em cascata pro WeatherAPI.com e tornando o ciclo muito mais lento que o normal. Em operação contínua (cron horário) a demanda fica distribuída e isso não deveria ocorrer — ver `scripts/diagnostico_expansao_nacional.md`.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 14 + TypeScript + Tailwind CSS |
| Mapa | Leaflet.js (Canvas renderer) + OpenStreetMap (CartoDB Dark Matter) |
| Banco | Supabase (PostgreSQL + Auth + Realtime) |
| Clima | Open-Meteo (camada 1) + WeatherAPI.com (camada 2, fallback de emergência) |
| Precipitação acumulada/pico | MERGE/CPTEC (satélite GPM/IMERG + pluviômetros INMET) |
| Maré | CPTEC/INPE (scraping da tábua oficial da Marinha — atualmente fora do ar) |
| Pré-processamento | Python (geopandas, rasterio, shapely, pyogrio) |
| Automação | GitHub Actions (cron horário: MERGE → scores) |
| PWA | next-pwa |

## Fontes de dados

| Fonte | Órgão | O que fornece | Status |
|---|---|---|---|
| SRTM | NASA / OpenTopography | Altimetria do terreno | ✅ Ativo |
| BHO | ANA | Rede hidrográfica nacional | ✅ Ativo |
| Setores censitários | IBGE | Malha de bairros/distritos | ✅ Ativo |
| MERGE/CPTEC | INPE | Chuva acumulada em 72h e pico de 3h (satélite + pluviômetros) | ✅ Ativo |
| Open-Meteo | Open-Meteo | Vento, umidade, pressão, chuva na última hora (camada 1) | ✅ Ativo |
| WeatherAPI.com | WeatherAPI | Mesmas variáveis, fallback de emergência (camada 2) | ✅ Ativo |
| Tábua de marés | Marinha do Brasil via CPTEC | Nível de maré por estação | 🔴 Fora do ar (fallback neutro) |
| Hidrografia do Recife | Prefeitura do Recife | Refinamento local de hidrografia | ✅ Ativo |
| Hidrografia de Sergipe | SERhidro/SEMAC | Refinamento local de hidrografia | ✅ Ativo |
| Hidrografia da Paraíba | AESA | Rede hídrica da Paraíba | 🟡 Baixada, não integrada |
| Bairros de Aracaju | MapAju / Prefeitura de Aracaju | Geometria oficial de bairros | ✅ Ativo |

## Rodando localmente

Pré-requisitos:
- Node.js e npm
- Projeto Supabase com as migrações aplicadas (`scripts/sql/001` a `024`)
- Python 3 com geopandas, rasterio, shapely, pyogrio (só para os scripts de pré-processamento)

Variáveis de ambiente (`.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_DB_PASSWORD=
SUPABASE_CONNECTION_STRING=
CRON_SECRET=
WEATHERAPI_KEY=
WEATHER_CACHE_ONLY=false
```

Instalar e rodar:
```bash
npm install
npm run dev
```

Forçar o cron manualmente:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/update
```

Usar `WEATHER_CACHE_ONLY=true` para desenvolvimento sem consumir a cota diária da Open-Meteo/WeatherAPI.

Antes do deploy, configurar os secrets da GitHub Action (`SUPABASE_CONNECTION_STRING`, `CRON_SECRET`, `APP_URL`) — ver [`scripts/SETUP_ACTIONS.md`](scripts/SETUP_ACTIONS.md).

## Documentação completa

- [RELATORIO_COMPLETO.md](RELATORIO_COMPLETO.md) — histórico completo do projeto, decisões, dificuldades e fontes
- [GitHub Wiki](https://github.com/luarawork/chuvarada/wiki) — Stack, Database, APIs, Score Model, Cobertura
- `/como-funciona` — explicação do modelo em linguagem acessível (dentro do app)

## Posicionamento

O Chuvarada complementa a informação pública, colocando dados abertos do governo nas mãos do cidadão comum. Não é crítica ao poder público — é parceria.

Construído com transparência: o app explica o modelo, admite as limitações (sem dados de bueiros ou galerias pluviais, maré em fallback neutro, distritos em vez de bairro onde o Censo não tem essa granularidade), e diferencia visualmente bairros com nome oficial de distritos administrativos usados como aproximação.
