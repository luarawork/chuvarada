# Validação Nacional — Chuvarada vs Eventos Reais de Alagamento

## Metodologia

- **Fontes de score do Chuvarada**: arquivo histórico no Backblaze B2 (`risk_scores/{ano}/{mes}/{dia}/scores_{data}_{estado}.json.gz`, gerado por `scripts/archive_to_b2.ts`) + tabela `risk_scores` ainda viva no Supabase (retenção de 48h).
- **Período coberto**: B2 = 18/07 a 27/07/2026 (180 arquivos, 316.121 linhas lidas); Supabase = 28/07 a 30/07/2026 (retenção corrente).
- **Fontes de validação**: busca de notícias/boletins de Defesa Civil na web, por estado e por município específico. **Não usa S2ID nem Atlas Digital de Desastres** — investigação anterior (ver conversa) confirmou que nenhuma das duas fontes tem dado publicado para 2026 ainda (defasagem burocrática real de declaração formal de município em SE/ECP).
- **Limite de método, declarado com transparência**: o cruzamento identificou **355 municípios em nível crítico só no período do B2**, mais um número adicional ainda no Supabase (ver abaixo). Verificar cada um individualmente contra notícia não é viável (seria bem mais de 400 buscas). Este relatório verifica uma **amostra representativa**: os municípios com maior score/mais horas em crítico por estado, mais os casos específicos que o usuário já havia pedido em turnos anteriores desta investigação. As métricas de recall/precisão abaixo valem só para essa amostra verificada, não para o total de 400+ instâncias — isso está marcado explicitamente onde relevante.

## Panorama consolidado

| Fonte | Município-estado únicos c/ score | Chegaram a crítico |
|---|---:|---:|
| B2 (18-27/07) | 5.570 (nacional completo) | **355** |
| Supabase (28-30/07) | — | **187** (164 RS + 16 SC + 3 MS + 3 PR + 1 RN) |

### Municípios críticos por estado

| Estado | B2 (18-27/07) | Supabase (28-30/07) |
|---|---:|---:|
| RS | 247 | 164 |
| PR | 59 | 3 |
| SC | 32 | 16 |
| RN | 13 | 1 |
| MS | 3 | 3 |
| PE | 1 | 0 |

O evento é dominado pelo Rio Grande do Sul do início ao fim da janela — consistente com o que a Defesa Civil do RS já vinha alertando desde 20-21/07 (chuva vermelha, rios em elevação) até pelo menos 29-30/07.

## Resultados por estado (amostra verificada)

### Rio Grande do Sul

| Município | Score máx | rain_72h | Nível modelo | Evento real | Classificação |
|---|---|---|---|---|---|
| Santa Cruz do Sul | 0,672 | 148,1mm | 🔴 Crítico (168h) | Enchente confirmada, 76,5% das residências da região afetadas (IBGE), Defesa Civil alertando **novo** alagamento em 28/07, Rio Pardinho subiu 3m em 2h | ✅ Acerto |
| Vanini / São Jorge / Ibiraiaras | 0,46-0,48 | 220-228mm | 🔴 Crítico | Defesa Civil do RS nomeou especificamente esses municípios da Serra Gaúcha em alerta de enchente | ✅ Acerto |
| Porto Alegre | 0,524 | 102,4mm | 🔴 Crítico (regra automática) | Temporal real 27/07: Av. 25 de Julho alagada, aeroporto suspenso ~40min, Guaíba subindo | ✅ Acerto |
| Canoas, Gravataí, Cachoeirinha, Novo Hamburgo, São Leopoldo, Esteio, Estância Velha, Sapucaia do Sul | 0,44-0,61 | 120-160mm | 🔴 Crítico | Corredor real do Vale do Sinos/Vale do Caí, sob alerta de 5 rios (Jacuí, Taquari, Caí, Gravataí, Sinos) segundo Defesa Civil estadual | ✅ Consistente com alerta oficial (não verificado individualmente por notícia própria) |
| **Santa Maria** | 0,44 | 96,75mm | 🟡 Atenção (nunca crítico) | Rio Vacacaí-Mirim **transbordou de verdade**, evacuação de bairros (João Goulart, Km 3, Campestre do Menino Deus), alerta vermelho INMET (>100mm) | ❌ **Subestimou** |

### Paraná

| Município | Score máx | rain_72h | Nível modelo | Evento real | Classificação |
|---|---|---|---|---|---|
| Cascavel | 0,399-0,436 | 48,8-113,3mm | 🔴 Crítico / 🟡 Atenção (varia por janela) | Chuva real **111,6mm** registrada, destelhamentos, Defesa Civil de plantão 24h | ✅ Acerto |
| Toledo | 0,418 | 102,3mm | 🔴 Crítico | Alerta laranja INMET pra 132 municípios do PR em 29/07, Toledo nomeado explicitamente | ✅ Acerto |

### Mato Grosso do Sul — achado de qualidade de dado

| Município | Score máx | rain_72h | Nível modelo | Evento real | Classificação |
|---|---|---|---|---|---|
| Naviraí | 0,403 | 121,9mm, **259h em crítico** (~11 dias seguidos) | 🔴 Crítico sustentado | Dado real de precipitação: só **34mm até 29/07** (51% da média mensal) — **bem abaixo** do normal, não avassalador | ⚠️ **Possível falso positivo / anomalia do MERGE** |
| Itaquiraí | 0,363 | 120,5mm | 🔴 Crítico | Dado real: 0mm até 08/07, um pico isolado de 66,8mm/24h depois — não bate com 120mm/72h sustentado | ⚠️ **Possível falso positivo / anomalia do MERGE** |

Isso é diferente dos outros achados: não parece ser o limiar da Regra 3 mal calibrado, e sim o **próprio MERGE** relatando um `rain_72h` alto e persistente (259 horas = quase 11 dias em crítico contínuo) numa região onde a chuva real observada foi modesta. Vale investigar a célula MERGE específica que cobre Naviraí/Itaquiraí antes de confiar nesse trecho do mapa.

## Métricas (sobre a amostra verificada, não sobre as 542 instâncias totais)

| Métrica | Valor |
|---|---|
| Casos verificados por notícia/Defesa Civil | 9 |
| ✅ Acertos (evento real confirmado + modelo em crítico) | 8 |
| ❌ Falso negativo (evento real, modelo não chegou a crítico) | 1 (Santa Maria) |
| ⚠️ Achado de qualidade de dado (modelo crítico, chuva real não confirma) | 2 (Naviraí, Itaquiraí) |
| "Recall" na amostra verificada | 8/9 ≈ 89% |

**Não é um recall nacional** — é só sobre os 9 casos que checamos individualmente. Generalizar isso pros outros ~530 municípios que também chegaram a crítico seria uma afirmação que os dados não sustentam.

## Casos de subestimação — para calibração futura

- **Santa Maria (RS)**: `rain_72h_max=96,75mm`, por pouco abaixo do limiar de 100mm da Regra 3, apesar de transbordamento real com evacuação. Sugere que 100mm pode estar um pouco alto pra bacias urbanas menores como a do Vacacaí-Mirim, ou que o MERGE está subestimando o acumulado ali especificamente (oposto do achado de MS, onde o MERGE superestima).

## Recomendações

- **Limiar de 100mm da Regra 3 pro Sul**: majoritariamente adequado — a grande maioria dos 8 acertos confirmados cruzou esse limiar de forma consistente com o evento real (Vanini/Ibiraiaras 220mm+, Santa Cruz do Sul 148mm, Porto Alegre 102mm). O caso isolado de Santa Maria (96,75mm, evento real confirmado) sugere que vale considerar um limiar ligeiramente mais baixo especificamente pra bacias urbanas pequenas, não uma mudança geral.
- **Investigar a célula MERGE de Naviraí/Itaquiraí (MS)**: 259 horas seguidas em crítico não bate com o clima real relatado (34mm/mês, bem abaixo da média) — parece um dado travado/anômalo no `merge_cache` pra essa região, não uma questão de calibração do modelo.
- **Pesos por região**: a validação não deu sinal de que os pesos precisam mudar — os acertos claros (RS, PR) usam o mesmo peso hoje idêntico entre regiões, e bateram bem com o evento real.
- **Fonte de dado faltando**: nenhuma nova lacuna identificada nesta rodada além do que já era conhecido (maré em fallback neutro, sem dado de infraestrutura de drenagem).
