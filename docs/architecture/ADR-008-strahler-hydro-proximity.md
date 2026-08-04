# ADR-008: Ponderação do hydro_proximity por ordem de Strahler

**Status:** Aplicado nacionalmente (28.483 bairros, 27 estados + DF)

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

## Aplicação nacional (25 estados restantes + DF)

Depois da validação em RN/RS, rodado pros outros 25 estados (todos exceto RN/RS, que já tinham sido feitos) — 24.512 bairros adicionais, 28.483 no total nacional.

| Métrica | Antes | Depois |
|---|---|---|
| Saturados (≥0,999), nacional | ~99% dos bairros | 0,1% (36 de 28.483) |
| Todos os 27 estados | — | cada um com 0 a 6 bairros saturados, nenhum concentrado fora do padrão |

**Casos de referência nacional** (top bairros por cidade, confirmado no banco):
- Porto Alegre/RS: 0,999 (Cristal, Santana)
- Salvador/BA: 0,996 (Vista Alegre)
- Recife/PE: 0,994 (Jaqueira)
- Belém/PA: ~0,87 (Bonfim) — mais baixo que as outras 3 capitais; plausível dado que o raio de busca de 0,2° (~22km) pode não alcançar o leito principal do Amazonas a partir de todos os centroides da cidade
- Manaus/AM: ~0,87 (Colônia Antônio Aleixo) — mesma explicação de Belém

### Nota técnica: protocolo simple query em vez de prepared statement

A primeira tentativa de rodar o `UPDATE` nacional falhou 2 vezes com erros de conexão (`unnamed prepared statement does not exist`, seguido de `bind message supplies N parameters, but prepared statement requires M` — a contagem de parâmetro exigida mudando sozinha entre tentativas). Causa: o pooler do Supabase em modo *transaction* (porta 6543) não é compatível com o protocolo estendido de prepared statement que `pg8000.native.Connection.run()` usa por padrão sempre que a chamada tem parâmetros nomeados (`:param`) — cada "transação" (aqui, cada UPDATE individual, já que a conexão não usa transação explícita) pode ser roteada pelo pooler pra uma conexão física de backend diferente, e o unnamed prepared statement de uma não é válido na outra.

Correção: montar o SQL diretamente (sem `:param`), forçando `conn.run()` a usar o protocolo *simple query* (sem prepared statement) — `conn.run(sql)` sem kwargs. Seguro aqui porque:
- `id` é validado por regex de UUID (`^[0-9a-fA-F]{8}-...$`) antes de entrar na string SQL — rejeita qualquer valor que não seja um UUID bem formado.
- `novo` é um `float` calculado pelo próprio script, nunca vindo de input externo.

Além disso, o script agora salva um checkpoint em CSV (`dados-brutos/ana/strahler_checkpoint.csv`, não versionado) logo após o cálculo geoespacial e antes de qualquer escrita no banco — recuperável via `--from-checkpoint` se o `UPDATE` falhar de novo, sem precisar recalcular (o cálculo geoespacial das ~24 mil bairros levou ~3h30 nesta rodada).

## Consequências

- `hydro_proximity` deixa de contribuir um valor quase constante (12% de peso em `lib/scoreConfig.ts`, mas sobre um dado saturado) e passa a discriminar de verdade entre bairro perto de rio grande vs. só córrego.
- Abre caminho pra retomar a distinção alagamento urbano vs. inundação fluvial (ver `docs/reports/diagnostico_mecanismos_impermeabilizacao.md`, seção A) com uma variável que de fato varia.
- `.gitignore` já cobre `dados-brutos/ana/*.gpkg` — o arquivo de 2,9GB baixado pro reprocessamento não é versionado; removido do disco (junto com o checkpoint CSV) depois da aplicação nacional confirmada.

## Limitações conhecidas

- **Pesos sem validação de hidrólogo** — degradê definido por julgamento, não por calibração formal. Revisar quando houver especialista disponível (mesma ressalva do Roadmap pra calibração regional).
- **Validação com casos reais só em RN e RS** — os 27 estados foram todos reprocessados, mas só RN (Natal) e RS (Santa Maria) têm evento de alagamento real documentado pra conferir se o resultado faz sentido. Belém e Manaus foram checados só por plausibilidade geográfica (ver seção de aplicação nacional acima), não contra um evento real.
- **Performance sem otimização** — o método (`.cx` bbox + loop Python por bairro, sem spatial index dedicado nem vetorização) levou ~3h30 pra calcular os ~24.500 bairros restantes depois de RN/RS. Funcionou, mas um spatial index reduziria isso bastante caso o script precise rodar de novo (ex: recalibração de pesos).
