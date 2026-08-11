# Variáveis Hidrológicas — Pesquisa e Candidatas

## Contexto
Pesquisa realizada em agosto/2026 para identificar
variáveis que tornariam o modelo mais robusto.

## Variáveis atuais do modelo

| Variável | Peso | Fonte |
|---|---|---|
| rain_peak_3h | 25% | MERGE/CPTEC |
| rain_1h | 20% | MERGE/CPTEC |
| rain_72h | 20% | MERGE/CPTEC |
| terrain_slope | 15% | NASA SRTM |
| hydro_proximity | 12% | ANA/BHO |
| tide_level | 8% | TideCheck |

## Candidatas identificadas

### soil_moisture — MAIOR IMPACTO POTENCIAL
- Fonte: Open-Meteo (soil_moisture_0_to_7cm) — gratuito,
  mesma API já integrada
- Por que importa: o mesmo evento de chuva pode gerar
  enchente de 15 anos ou de 100 anos dependendo da
  saturação prévia do solo
- É o pilar central da metodologia Flash Flood Guidance
  (NWS/NOAA)
- Caso de referência: enchentes Zona da Mata Mineira
  (fev/2026)
- Status: roadmap, requer calibração de especialista

### surface_pressure
- Fonte: Open-Meteo (já capturado mas não usado)
- Impacto: baixo-moderado — mais útil para previsão
  do que para nowcast
- Status: descartada por ora

### windspeed_10m
- Fonte: Open-Meteo (já capturado mas não usado)
- Impacto: baixo-moderado — ligação indireta com alagamento
- Status: pode entrar em produto de vento futuro

### duração contínua da chuva
- Não é campo direto — precisaria derivar de série horária
- Impacto: plausível mas maior esforço de implementação
- Status: roadmap futuro

## Eventos hidrológicos estudados

### Santa Maria/RS (jul/2026)
- Rio Vacacaí-Mirim transbordou com evacuação real
- Modelo ficou 3.25mm abaixo do limiar automático
- Subestimação documentada: aponta para necessidade de
  calibração de limiares para bacias urbanas menores no Sul

### Zona da Mata Mineira (fev/2026)
- Juiz de Fora e região — deslizamentos e enchentes
- Mesma região com MERGE estagnado em estação seca
- Caso de referência para soil_moisture

## Referências internacionais

### First Street Foundation (EUA)
- Score de risco por propriedade/bairro (1-10)
- Variáveis: elevação, precipitação histórica,
  proximidade de corpos d'água, adaptações estruturais,
  histórico de inundações
- Desvio da média histórica como contexto para o usuário

### PRISM/WFP (ONU)
- Integra dados de seca, enchentes, tempestades
- Usa NDVI, precipitação, temperatura, dados socioeconômicos
- Desvio da média histórica por região — já implementamos

## O gap do Brasil

Nenhuma ferramenta pública brasileira responde
"o que está acontecendo no meu bairro agora?"
para o cidadão comum em tempo real.
