# ADR-008: Ponderação do hydro_proximity por ordem de Strahler

**Status:** Aplicado em RN e RS (3.971 bairros); aguardando aprovação para o Brasil inteiro (ver Limitações)

## Contexto

O `hydro_proximity` original (`scripts/python/process_bho.py`) calculava distância até `unary_union` de todos os trechos de rio da BHO/ANA — córrego e rio de grande porte tratados como o mesmo peso. Resultado (diagnóstico de 03/08/2026, `docs/reports/diagnostico_mecanismos_impermeabilizacao.md`): 99% dos bairros do país com `hydro_proximity` saturado perto de 1,0, sem poder discriminante nenhum entre mecanismo de inundação fluvial e alagamento urbano.

A BHO/ANA (`geoft_bho_curso_dagua.gpkg`) tem duas colunas relevantes não usadas antes: `nuordemcda` (ordem hierárquica do trecho) e `nuareabacc` (área de bacia contribuinte, km²). A documentação pública da ANA nomeia o conceito equivalente como "CDA_NU_ORDEM"/"ordem de Strahler", mas o GeoPackage real exporta com nomenclatura interna curta — confirmado direto no arquivo (2.751.685 trechos nacionais), não só pela documentação.

**Achado importante durante a implementação:** `nuordemcda` está na direção OPOSTA da convenção clássica de Strahler (onde ordem cresce rio abaixo). Nos dados reais, ordem 1 = tronco principal de maior porte (mediana de 4,3km² de área de bacia, com trechos individuais chegando a 5,9 milhões de km²) e a área de bacia cai monotonicamente até ordem 13 (mediana de 0,048km², cabeceira mínima). Confirmado comparando mediana de `nuareabacc` por `nuordemcda` em todo o dataset nacional, não só numa amostra pequena — uma amostra de 2.000 linhas inicial não teria revelado essa inversão.

## Decisão

Novo script `scripts/python/process_bho_strahler.py` (não substitui `process_bho.py`, preservado como referência). Para cada bairro, calcula:

```
score = max(peso_ordem(trecho) × (1 - distância_normalizada))
```

entre todos os trechos de rio dentro de 0,2° (~22km) do centroide — em vez de usar o rio mais próximo sozinho, o bairro herda o score do MELHOR trecho no raio (rio grande um pouco mais longe pode pontuar mais que córrego minúsculo bem perto).

### Pesos por `nuordemcda` (direção corrigida — ordem 1 = maior porte)

| Ordem | Peso | % dos trechos nacionais |
|---|---|---|
| 1 | 1,00 | 0,11% |
| 2 | 0,90 | 1,59% |
| 3 | 0,75 | 7,79% |
| 4 | 0,60 | 18,12% |
| 5 | 0,45 | 24,84% |
| 6 | 0,35 | 22,85% |
| 7 | 0,25 | 15,11% |
| 8 | 0,15 | 6,96% |
| 9 | 0,10 | 2,16% |
| ≥10 | 0,08 | 0,46% |
| nulo | 0,30 (neutro) | — |

Sem validação de hidrólogo — degradê suave escolhido pra evitar degraus abruptos entre ordens adjacentes, já que 66% dos trechos nacionais caem entre ordem 4 e 6.

## Simulação e aplicação em RN + RS

Primeiro simulado (`--dry-run`, sem escrita), depois aplicado de verdade no banco (`UPDATE neighborhoods`) após validação dos resultados:

| Estado | Bairros | Saturados (≥0,999) antes | Saturados depois (confirmado no banco) | Média antes → depois | Desvio antes → depois |
|---|---|---|---|---|---|
| RN | 375 | 60,0% | 0,3% (1 bairro) | 0,934 → 0,839 | 0,136 → 0,099 |
| RS | 3.596 | 81,9% | 0,2% (2 bairros) | 0,971 → 0,700 | 0,109 → 0,131 |

A saturação em ~1,0 praticamente desaparece nos dois estados, apesar do padrão de mudança em média/desvio ser diferente entre eles (RS ganhou mais dispersão, RN perdeu um pouco — esperado, hidrografias diferentes). 3.971 bairros atualizados no total, confirmado por query direta no banco (não só pelo log do script).

**Casos-caso validados:**
- **Natal/RN** (evento real de alagamento urbano confirmado): bairros do evento de jul/2026 (Candelária, Cidade da Esperança, Capim Macio, Ponta Negra, Nossa Senhora de Nazaré, Potengi) sobem substancialmente (+0,25 a +0,60) — fazem sentido por estarem perto do estuário do Potengi, um rio de porte real, não um córrego qualquer.
- **Santa Maria/RS** (transbordamento real do Vacacaí-Mirim): bairros da evacuação real (Camobi, Km Três, Campestre do Menino Deus, Presidente João Goulart) saem da saturação em 1,0 e ficam na faixa 0,68–0,74 — nem esmagados a zero, nem mais artificialmente máximos: um valor moderado-alto consistente com estar perto de um rio real que de fato transbordou.

## Consequências

- `hydro_proximity` deixa de contribuir um valor quase constante (12% de peso em `lib/scoreConfig.ts`, mas sobre um dado saturado) e passa a discriminar de verdade entre bairro perto de rio grande vs. só córrego.
- Abre caminho pra retomar a distinção alagamento urbano vs. inundação fluvial (ver `docs/reports/diagnostico_mecanismos_impermeabilizacao.md`, seção A) com uma variável que de fato varia.
- `.gitignore` já cobre `dados-brutos/ana/*.gpkg` — o arquivo de 2,9GB baixado pra esta simulação não é versionado.

## Limitações conhecidas

- **Pesos sem validação de hidrólogo** — degradê definido por julgamento, não por calibração formal. Revisar quando houver especialista disponível (mesma ressalva do Roadmap pra calibração regional).
- **Só 2 dos 27 estados simulados** (RN, RS) — cobre os 2 casos de validação disponíveis, mas não garante que o comportamento se generaliza igual pra todo o país (ex: Amazônia, com rios de porte totalmente diferente da escala usada aqui).
- **Performance da simulação não testada em escala nacional** — o método atual (`.cx` bbox + loop Python por bairro) rodou RN (375 bairros) e RS (3.596 bairros) em minutos; rodar os ~28.483 bairros nacionais nesse ritmo pode levar bem mais tempo. Não otimizado ainda (ex: spatial index dedicado, vetorização) porque a simulação em 2 estados já era suficiente pra validar a abordagem antes de investir nisso.
- **Só RN e RS aplicados no banco até agora** — os outros 25 estados seguem com o `hydro_proximity` antigo (saturado). Aguardando aprovação explícita antes de rodar pro Brasil inteiro.
