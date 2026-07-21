# Chuvarada 🌧️

Mapa de risco de alagamento em tempo real para o Nordeste brasileiro.
Civic tech com personalidade — confiável mas humano.

## O que é

O Chuvarada cruza dados públicos de clima, terreno, hidrografia e maré para estimar, em tempo real e por bairro, o risco de alagamento em cidades do Nordeste. Atualizado a cada hora. Sem jargão técnico na interface. Feito para o cidadão comum, não para especialistas.

O aquecimento global vem tornando eventos de chuva mais intensos e concentrados no tempo. Cidades do Nordeste brasileiro, com infraestrutura de drenagem historicamente subdimensionada, não foram projetadas para esse regime de chuva mais extremo. O Chuvarada tenta preencher o vão entre os alertas oficiais (por cidade ou região) e a pergunta real do cidadão: meu bairro está em risco agora?

## Cobertura atual

| Métrica | Valor |
|---|---|
| Estados | 9 (todo o Nordeste) |
| Municípios | 1.794 (100% dos municípios IBGE) |
| Bairros/distritos | 7.117 |
| Com score calculado | 99,6% |
| Municípios costeiros com dado de maré | 91 de 171 (53%) |

## Como funciona

O modelo calcula um score de 0 a 1 para cada bairro, combinando 6 variáveis:

| Variável | Peso | Fonte |
|---|---:|---|
| Pico de chuva nas últimas 3h | 25% | Open-Meteo |
| Chuva na última hora | 20% | Open-Meteo |
| Chuva acumulada em 72h | 20% | Open-Meteo |
| Declividade do terreno | 15% | NASA SRTM |
| Proximidade de rios/canais | 12% | ANA/BHO + hidrografia local |
| Nível de maré | 8% | Marinha do Brasil via CPTEC |

Níveis de risco:
- 🟢 Normal: score < 0,30
- 🟡 Atenção: score 0,30 – 0,60
- 🔴 Crítico: score > 0,60

Além do score, 3 regras disparam nível crítico automaticamente:
- Chuva > 50mm na última hora
- Maré alta (>80%) + chuva em zona costeira
- Solo saturado (>100mm/72h) + qualquer chuva nova

Para municípios sem estação de maré próxima (>80km), o peso de 8% da maré é redistribuído proporcionalmente entre as demais variáveis.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 14 + TypeScript + Tailwind CSS |
| Mapa | Leaflet.js + OpenStreetMap (CartoDB Dark Matter) |
| Banco | Supabase (PostgreSQL + Auth + Realtime) |
| Clima | Open-Meteo (histórico observado real, sem chave de API) |
| Maré | CPTEC/INPE (scraping da tábua oficial da Marinha do Brasil) |
| Pré-processamento | Python (geopandas, rasterio, shapely, pyogrio) |
| PWA | next-pwa |

## Fontes de dados

| Fonte | Órgão | O que fornece |
|---|---|---|
| SRTM | NASA / OpenTopography | Altimetria do terreno |
| BHO | ANA | Rede hidrográfica nacional |
| Setores censitários | IBGE | Malha de bairros/distritos |
| Tábua de marés | Marinha do Brasil via CPTEC | Nível de maré por estação |
| Clima em tempo real | Open-Meteo | Precipitação, vento, umidade, pressão |
| Hidrografia do Recife | Prefeitura do Recife | Refinamento local de hidrografia |
| Hidrografia da PB | AESA | Rede hídrica da Paraíba |
| Hidrografia de SE | SERhidro/SEMAC | Rede hídrica de Sergipe |
| Bairros de Aracaju | MapAju / Prefeitura de Aracaju | Geometria oficial de bairros |

## Rodando localmente

Pré-requisitos:
- Node.js e npm
- Projeto Supabase com as migrações aplicadas (scripts/sql/001 a 012)
- Python 3 com geopandas, rasterio, shapely, pyogrio (só para os scripts de pré-processamento)

Variáveis de ambiente (.env.local):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_DB_PASSWORD=
SUPABASE_CONNECTION_STRING=
CRON_SECRET=
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

Usar `WEATHER_CACHE_ONLY=true` para desenvolvimento sem consumir a cota diária da Open-Meteo.

## Documentação

- [RELATORIO_COMPLETO.md](RELATORIO_COMPLETO.md) — histórico completo do projeto, decisões, dificuldades e fontes
- [GitHub Wiki](https://github.com/luarawork/chuvarada/wiki) — Stack, Database, APIs, Score Model
- `/como-funciona` — explicação do modelo em linguagem acessível (dentro do app)

## Posicionamento

O Chuvarada complementa a informação pública, colocando dados abertos do governo nas mãos do cidadão comum. Não é crítica ao poder público — é parceria.

Construído com transparência: o app explica o modelo, admite as limitações (sem dados de bueiros ou galerias pluviais), e diferencia visualmente bairros com nome oficial de distritos administrativos usados como aproximação.
