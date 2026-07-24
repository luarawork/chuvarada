# Relatório de Testes Pré-Deploy — Chuvarada

**Data**: 2026-07-21
**Escopo**: bateria completa de testes antes do deploy, conforme pedido. Só diagnóstico — nenhuma linha de código foi alterada durante esta rodada.

---

## Resumo executivo

| # | Teste | Status |
|---|---|---|
| 1.1 | Buscar eventos reais de alagamento (30 dias) | ✅ 4 de 6 cidades com evento datado/localizado |
| 1.2 | Comparar MERGE vs Open-Meteo por evento | ✅ feito para os 4 eventos |
| 1.3 | Score hipotético por evento | ⚠️ nenhum evento testado bateu "crítico" nas duas fontes ao mesmo tempo — ver achado abaixo |
| 2.1 | Histórico de execuções do cron (24h) | ❌ gap de ~21h sem nenhuma execução — não há agendador ativo |
| 2.2 | Consistência do `merge_cache` | ✅ sem anomalia |
| 2.3 | Fallback MERGE vs Open-Meteo | ⚠️ só 13% das células com dado atual usam MERGE (limite do rate limiter da Open-Meteo) |
| 2.4 | Dados travados | ❌ 89% das cidades com cache >2h; 20% com >24h |
| 3.1 | Bairros críticos/atenção plausíveis | ✅ geograficamente coerente (concentrados em Natal, evento real em curso) |
| 3.2 | Anomalia entre bairros vizinhos | ✅ sem anomalia |
| 3.3 | Distribuição por estado | ✅ sem estado suspeito |
| 4.1 | Regras disparando (24h) | ✅ só Regra 3 disparou até agora (esperado, sem dado real de Regras 1/2 ainda) |
| 4.2 | Transições crítico→normal | ✅ nenhuma no período (esperado, dado o gap da seção 2.1) |
| 4.3 | Testes sintéticos das 4 regras | ⚠️ 3 de 4 bateram; Regra 2 revelou um achado real (ver abaixo) |
| 5.1 | Robustez a 404 do CPTEC | ✅ gracioso, sem travar |
| 5.2 | Cobertura do bbox do MERGE | ⚠️ 6 bairros (0,08%) fora, extremo norte do MA |
| 5.3 | Latência real do MERGE | ✅ ~3h43min, dentro do esperado (~3,5h) |
| 6.1 | Tempo de ciclo completo do cron | ✅ 5min31s pra 7.117 bairros |
| 6.2 | Supabase Realtime | ⚠️ mapa atualiza sozinho; painel de detalhe aberto não |

---

## 1. Validação do modelo com eventos históricos reais

Busquei eventos de alagamento confirmados nos últimos ~30 dias (junho-julho 2026) nas 6 capitais pedidas. Encontrei 4 com data, local e fonte jornalística claros:

| Evento | Data | Fonte |
|---|---|---|
| Recife (avenidas alagadas — Madalena, Ibura, Imbiribeira) | 26/06/2026 | [Portal de Prefeitura](https://portaldeprefeitura.com.br/clima/chuva-forte-causa-alagamentos-em-avenidas-do-recife-nesta-sexta-26/625302/), [Terra](https://www.terra.com.br/noticias/previsao-do-tempo/chuva-forte-causa-alagamentos-em-avenidas-do-recife-nesta-sexta-26,0640607e50d2661bdd5ee3cb33086497t15m7f6a.html) |
| João Pessoa (Valentina Figueiredo, Miramar, Colinas do Sul) | 26/06/2026 | [CNN Brasil](https://www.cnnbrasil.com.br/nacional/nordeste/pb/chuvas-provocam-deslizamentos-e-deixam-desabrigados-em-joao-pessoa-pb/), [Blog do BG](https://www.blogdobgpb.com.br/2026/06/26/video-fortes-chuvas-causam-alagamentos-e-interdicao-de-viaduto-em-joao-pessoa/) |
| Maceió (alerta laranja Defesa Civil, 74-80mm/24h) | 26/06/2026 | [Francês News](https://francesnews.com.br/post/2026/06/26/29056-alagoas-entra-em-alerta-para-chuvas-intensas-maceio-ja-acumula-ate-80-mm-em-12-horas) |
| Natal (Pitimbú e outros — já testado em sessão anterior) | 17-18/07/2026 | [Tribuna do Norte/Emparn](https://tribunadonorte.com.br/natal/natal-registra-chuva-de-1136-mm-aponta-boletim-da-emparn/) — 113,6mm/24h |

**Não encontrei** evento com data/bairro específico pra **Salvador** (só agregados mensais por bairro sem data exata, ex: Coutos 85,4mm em junho) nem **Fortaleza** (só eventos de janeiro/maio, fora da janela de 30 dias). Não forcei nenhum evento fabricado pra preencher a lacuna.

### Comparação MERGE vs Open-Meteo (dado real, baixado e extraído nesta sessão)

| Evento | `rain_72h` MERGE | `rain_72h` Open-Meteo | Score c/ MERGE | Score c/ Open-Meteo |
|---|---:|---:|---|---|
| Natal/Pitimbú | ~127-147mm | ~30mm | 0,40 **crítico** | 0,25 normal |
| Recife/Ibura | 51,1mm | 92,7mm | 0,49 atenção | 0,67 **crítico** |
| João Pessoa/Valentina | 65,5mm | 74,8mm | 0,43 atenção | 0,39 atenção |
| Maceió/Centro | 57,7mm | 82,2mm | 0,52 atenção | 0,54 atenção |

**Achado central**: o padrão de Natal (MERGE corrige uma Open-Meteo que subestima) **se inverteu** no evento de Recife — lá, é a Open-Meteo que captura melhor o pico de chuva (92,7mm vs 51,1mm do MERGE). Como a integração atual **sempre prioriza o MERGE quando disponível, sem comparar com a Open-Meteo**, esse é um cenário real e documentado onde a fonte preferencial hoje entrega um resultado pior que a alternativa que ela substituiu. Nenhum dos 4 eventos testados bateu "crítico" nas duas fontes simultaneamente — isso não é necessariamente falha do modelo (reflete a limitação já documentada de não ter dado de bueiros/drenagem), mas expõe que a escolha de sempre priorizar MERGE sobre Open-Meteo precisa de revisão (ver proposta original, Opção B: MERGE como validação/correção, não substituição cega).

Também não encontrei o bairro "Colinas do Sul" (citado na notícia de João Pessoa) na base — provável nome alternativo ou subdivisão não capturada pelo Censo.

---

## 2. Estabilidade do cron

**2.1 — 🔴 achado mais sério de toda a bateria**: no histórico de `risk_scores` das últimas 24h, há um buraco de **~21 horas sem nenhuma execução** do cron. Ele só rodou quando disparado manualmente nesta sessão de testes — **não existe nenhum agendador ativo** (nem Vercel Cron, nem cron de sistema operacional, nem qualquer outro mecanismo). Isso é esperado em ambiente de desenvolvimento, mas **bloqueia o deploy** até ser configurado.

**2.2**: `merge_cache` com 31.500 células, 100% "recentes" (populado numa única rodada do script). `rain_72h` de 0 a 148,63mm, média 3,75mm — sem anomalia.

**2.3/2.4**: olhando a leitura mais recente por célula (não o histórico agregado de toda a sessão):
- Só **500 de 3.849 células com dado atual (13%)** usam MERGE — o resto usa Open-Meteo, travado pelo rate limiter interno de 500 chamadas/hora.
- **1.597 de 1.794 cidades (89%)** têm weather_cache com **mais de 2 horas**; **354 (20%)** com mais de **24 horas**.

Isso é consequência direta de (a) não haver agendador rodando a cada 20 minutos nesta sessão de testes e (b) o rate limiter permitir só ~500 células frescas por hora contra as ~2.500-3.000 únicas do Nordeste inteiro. Com cron ativo em produção, isso se resolveria sozinho ao longo de poucas horas — mas os primeiros ciclos após o deploy vão mostrar a maior parte do mapa com dado desatualizado até o cache "esquentar".

**Achado adicional (revisão de código)**: quando a Open-Meteo falha e o código usa o fallback com sobreposição do MERGE, o resultado combinado **não é regravado** em `weather_cache` (só o cálculo do score em memória se beneficia). Isso faz a coluna `rain_source` subestimar o uso real do MERGE — inconsistência só de observabilidade, não uma falha funcional.

---

## 3. Consistência geográfica do mapa

**3.1**: os 30 bairros de maior score são todos de Natal — plausível, é a única cidade com evento de chuva real em andamento capturado pelo MERGE nesta janela. Todos com `auto_critical=true` via "Solo saturado com nova precipitação".

**3.2**: sem anomalia entre bairros vizinhos — os 36 bairros de Natal variam suavemente de 0,319 a 0,455 em score, todos com `rain_72h` consistente.

**3.3**: distribuição por estado plausível — RN concentra os 36 críticos, PE tem 35 em atenção, demais estados majoritariamente normais com score máximo entre 0,24 e 0,33. Nenhum estado com padrão suspeito.

---

## 4. Regras de crítico automático

**4.1**: nas últimas 24h, só a Regra 3 ("Solo saturado") disparou — 36 ocorrências, todas em Natal. Regras 1 e 2 nunca dispararam em produção real ainda.

**4.2**: nenhuma transição crítico→normal observada (esperado, dado o gap de execuções da seção 2.1).

**4.3 — testes sintéticos** (replicando a fórmula exata de `lib/score.ts`, sem alterar código):

| Regra | Resultado | Esperado | Status |
|---|---|---|---|
| 1 (rain_1h>50) | crítico, "Chuva extrema na última hora" | crítico | ✅ |
| 2 (maré+costeira) | atenção, auto_critical=false | crítico | ❌ à primeira vista |
| 3 (solo saturado) | crítico, "Solo saturado..." | crítico | ✅ |
| Normal | normal | normal | ✅ |

**Investigação da Regra 2**: o caso de teste fornecido não especifica `rain_3h` (só `rain_1h`, `rain_72h`, `rain_peak_3h`), mas a regra depende de `rain_3h > 20mm`. Testando de novo com `rain_3h=25` explícito, **a regra disparou corretamente**. A lógica está certa; o caso de teste estava incompleto.

**Achado real e mais sério, descoberto ao investigar isso**: `rain_3h` não aparece em nenhum lugar da UI nem do `/como-funciona` (só `rain_peak_3h`, `rain_1h`, `rain_72h` são documentadas) — é um campo interno só usado pela Regra 2. E no fallback de cache expirado (`weatherFromCache`), `rain_3h` é **aproximado como igual a `rain_1h`** (o próprio comentário no código já assume essa limitação). Como a seção 2 mostrou que 89% das cidades estão em cache expirado agora, **a Regra 2 está estruturalmente enfraquecida** pra maior parte do Nordeste na maior parte do tempo.

---

## 5. Script do MERGE

**5.1**: confirmado — pedir uma data futura inexistente (22/07) retorna HTTP 404 limpo. O script trata isso graciosamente, logando o aviso e recuando pra dias/horas anteriores sem travar.

**5.2**: a query original (PostGIS) não funciona neste banco (`geometry` é `jsonb`, não um tipo geométrico nativo — PostGIS não está habilitado). Refeita com Turf.js: **6 de 7.117 bairros (0,08%)** ficam fora do bbox do MERGE — extremo norte do Maranhão (Carutapera, Godofredo Viana, Luís Domingues, Apicum-Açu, Cândido Mendes), passando o limite norte por até 0,27° (~30km). Correção trivial (alargar o bbox).

**5.3**: arquivo `HOURLY_NOW` mais recente é o de 22h UTC de 20/07, publicado às 01:40:42 de 21/07 — **latência real de ~3h43min**, dentro do esperado.

---

## 6. Teste de carga e performance

**6.1**: cron completo levou **5min31s** pra atualizar 7.117 bairros (100%). Dentro desse tempo, só 500 chamadas frescas à Open-Meteo foram concluídas (limite do rate limiter interno); o restante usou cache combinado com MERGE via a correção da tarefa anterior.

**6.2**: Realtime funciona pra cor dos polígonos do mapa — mas **o painel de detalhe de um bairro aberto não atualiza sozinho**. Confirmado com uma nova linha real gravada em `risk_scores` para Pitimbú (score mudou de 0,4023→0,4039) enquanto o painel estava aberto: nem o score nem o histórico do painel refletiram a mudança sem reload. Causa: `hooks/useRisk.ts` busca uma vez só (`useEffect` sem assinatura), diferente de `hooks/useRealtime.ts` (usado só pelas cores do mapa em `app/page.tsx`), que tem a assinatura `postgres_changes`.

---

## Problemas encontrados

### 🔴 Crítico — bloqueia o deploy
1. **Nenhum agendador de cron configurado.** Sem isso, o app em produção nunca teria dado atualizado sozinho — precisa de Vercel Cron Jobs (ou equivalente) chamando `/api/cron/update` a cada 20 minutos antes do deploy ir ao ar.

### 🟡 Médio — deve ser corrigido mas não bloqueia
2. **MERGE sempre prioriza sobre Open-Meteo sem comparação** — o evento de Recife (26/06) mostrou um caso real onde a Open-Meteo captava melhor a chuva. Vale revisar a Opção B da proposta original (MERGE como validação/correção, comparando as duas fontes, não substituindo cegamente).
3. **Regra 2 (maré+costeira) estruturalmente enfraquecida no fallback de cache** — `rain_3h` colapsa pra `rain_1h` quando o cache está expirado, o que acontece pra 89% das cidades agora. `rain_3h` também não é documentada em nenhum lugar visível ao usuário.
4. **Painel de detalhe de bairro não atualiza via Realtime** — só as cores do mapa atualizam sozinhas; um usuário com o painel aberto durante um evento real não vê a mudança sem fechar/reabrir ou recarregar.
5. **`weather_cache.rain_source` subestima o uso real do MERGE** — o fallback com sobreposição não regrava o cache, só o cálculo em memória se beneficia (observabilidade, não funcional).
6. **Rate limiter interno da Open-Meteo (500/h) insuficiente pra atualizar o Nordeste inteiro num só ciclo** — só ~13-19% das células conseguem dado fresco por hora; o restante depende de ciclos sucessivos acumularem cobertura ao longo do tempo.

### 🟢 Baixo — melhoria futura
7. 6 bairros (0,08%) no extremo norte do MA fora do bbox do MERGE — correção trivial.
8. Bairro "Colinas do Sul" (citado em notícia real de João Pessoa) não existe na base com esse nome — possível gap de nomenclatura do Censo.

---

## Recomendação

**Não está pronto pro deploy como está — há um bloqueador real (🔴) e não um problema de qualidade de dado.** O item que realmente impede subir agora é a ausência de agendador: sem ele, o produto em produção mostraria dado cada vez mais velho, e ninguém perceberia até um usuário reclamar. Isso precisa ser resolvido primeiro — não é um problema do modelo, é infraestrutura de deploy que ainda não foi configurada (ver `RELATORIO_COMPLETO.md`, item "o que ainda falta": deploy é fase futura, "Netlify cogitado" — mas o agendador do cron é uma peça independente da escolha de hospedagem, precisa existir de qualquer forma).

**Ordem recomendada**:
1. Configurar o agendador do cron (bloqueador — sem isso, nada mais importa).
2. Revisar a prioridade MERGE-sempre-vence (achado #2) — considerar comparar as duas fontes em vez de substituir cegamente, dado o caso real de Recife.
3. Resolver o `rain_3h` no fallback (achado #3) — ou documentar a variável, ou parar de aproximá-la incorretamente.
4. Os achados #4, #5, #6, #7, #8 podem ser tratados como *fast-follow* pós-deploy — não bloqueiam, mas valem tickets próprios.

Nada foi alterado no código durante esta bateria de testes, conforme pedido.
