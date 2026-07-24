# Proposta de integração: MERGE/CPTEC como fonte de precipitação

**Data**: 2026-07-21
**Status**: proposta para revisão — nada foi implementado, nenhum código ou schema foi alterado.
**Contexto**: motivado pelo evento real de alagamento em Natal (18/07/2026), onde a Open-Meteo subestimou a chuva (~30mm vs os ~147mm reais medidos pelo MERGE/CPTEC no mesmo período — ver `RELATORIO_COMPLETO.md` e o diagnóstico anterior desta sessão).

---

## 1. Como funciona o dado

- **URL base**: `https://ftp.cptec.inpe.br/modelos/tempo/MERGE/GPM/` — diretório HTTPS público, **sem autenticação nenhuma** (confirmado nesta sessão).
- **Estrutura de pastas**:
  ```
  MERGE/GPM/DAILY/{ano}/{mes}/MERGE_CPTEC_{YYYYMMDD}.grib2
  MERGE/GPM/HOURLY_NOW/{ano}/{mes}/{dia}/MERGE_CPTEC_{YYYYMMDDHH}.grib2
  ```
  `DAILY` tem 1 arquivo por dia (acumulado 24h, referenciado a 12Z). `HOURLY_NOW` tem até 24 arquivos por dia (um por hora, `HH` de `00` a `23`, horário UTC) — confirmei os dois formatos baixando arquivos reais de 17-20/07/2026.
- **Formato**: GRIB2 — mesmo formato usado por modelos meteorológicos operacionais (GFS, ECMWF etc). Não é GeoJSON nem NetCDF. Legível via GDAL, que já é dependência transitiva do projeto (`rasterio`/`geopandas`, já usados em `scripts/process_*.py`).
- **Banda de precipitação**: banda 1 (`PREC`, unidade `kg/m²` — equivalente a mm de lâmina d'água). Confirmado via o `.ctl` (descritor GrADS que acompanha cada arquivo): *"MERGE GENERATED FROM GPM-IMERG-late"* — ou seja, é literalmente o IMERG Late Run fundido com a rede de pluviômetros do INMET/Defesa Civil pelo próprio CPTEC.
- **Grade**: 0,1° × 0,1° (~10km), `xdef 1001 linear -120.05 0.1`, `ydef 924 linear -60.05 0.1` — cobre de -120,05° a -20° de longitude e -60,05° a 32,3° de latitude. **Cobre a América do Sul inteira, não só o Brasil** (a extensão inclui parte do Pacífico/Atlântico e países vizinhos) — o Nordeste brasileiro está bem dentro dessa área, sem risco de borda.
- **Como localizar a célula certa por lat/lng**: com a grade regular documentada no `.ctl`, dá pra calcular o índice de pixel diretamente (`col = round((lng - (-120.05)) / 0.1)`, `row = round((top - lat) / 0.1)` com `top = 32.3`), sem precisar abrir o arquivo pra "procurar" — mesma lógica que `rasterio.index()` já faz internamente (validado nesta sessão, os valores batem).
- **Limitação conhecida**: o `.ctl` documenta uma banda 2 chamada `NEST` ("número de estações por ponto de grade", um indicador de confiança). Testei essa banda no arquivo `DAILY` de 18/07 e ela **não contém isso** — contém pressão ao nível do mar (`PRMSL`), aparentemente um artefato de um template genérico reaproveitado entre produtos diferentes do CPTEC. **Não dá pra confiar na banda 2 como indicador de confiança sem mais investigação** — a proposta abaixo usa só a banda 1 (`PREC`), que se comportou de forma consistente e correta em todos os testes.

---

## 2. O que o MERGE substituiria no modelo atual

| Variável | Hoje (Open-Meteo) | Proposta (MERGE) | Por quê |
|---|---|---|---|
| `rain_72h` | Soma de 72h do histórico `past_days` | Soma dos últimos 3 arquivos `DAILY` (72h) | MERGE tem resolução 2,5× melhor e incorpora pluviômetros reais — é exatamente a variável que falhou no evento de Natal |
| `rain_peak_3h` | Máximo horário das últimas 3h (`hourly.precipitation`) | Máximo horário dos últimos 3 arquivos `HOURLY_NOW` | Mesma lógica, só trocando a fonte do dado horário |
| `rain_1h` | Valor da última hora (Open-Meteo) | **Mantém Open-Meteo** | MERGE tem ~3,5h de latência — usar MERGE aqui faria `rain_1h` mostrar sempre "há 3,5h", pior que o que já existe |
| Vento, umidade, pressão | Open-Meteo | **Mantém Open-Meteo** | MERGE só tem precipitação, nenhuma outra variável atmosférica |

Ou seja: a integração é **cirúrgica** — só troca a fonte de 2 das 6 variáveis do modelo (`rain_72h` e `rain_peak_3h`, que juntas já são 45% do peso), sem tocar em maré, terreno, hidrografia, nem nas variáveis de exibição do painel (vento/umidade/pressão continuam vindo da Open-Meteo).

---

## 3. Estrutura de cache proposta

**Recomendo tabela nova (`merge_cache`), não estender `weather_cache`.** Comparando as duas abordagens:

| | Estender `weather_cache` | Tabela nova `merge_cache` |
|---|---|---|
| Granularidade temporal | `weather_cache` guarda 1 leitura por célula por *fetch* (a cada ciclo de 20min) — mas o MERGE só produz 1 arquivo novo por hora (`HOURLY_NOW`) ou por dia (`DAILY`). Colunas extras ficariam repetindo o mesmo valor em várias linhas de 20min, sem necessidade | Cada linha representa 1 arquivo MERGE processado (1/hora ou 1/dia) — sem repetição |
| Diferenciar DAILY vs HOURLY_NOW | Precisaria de uma coluna `source_type` misturada com dado de outra API | Natural — a tabela já é dedicada, um campo `product` (`daily`/`hourly_now`) resolve sem ambiguidade |
| Risco de acoplamento | Alto — mistura o ciclo de atualização da Open-Meteo (20min) com o do MERGE (1h/24h), tornando fácil introduzir bug de "achar que tem dado novo quando na verdade é o mesmo arquivo relido" | Baixo — cada fonte mantém seu próprio ritmo de gravação |
| Rollback / desligar a integração | Precisaria de migração pra remover colunas de uma tabela em uso constante | Só para de escrever na tabela nova; `weather_cache` nunca foi tocada |

**Proposta de schema**:

```sql
create table if not exists merge_cache (
  id uuid primary key default gen_random_uuid(),
  grid_lat float not null,
  grid_lng float not null,
  product text not null check (product in ('daily', 'hourly_now')),
  reference_time timestamptz not null,   -- dia (00:00Z) ou hora (HH:00Z) que o arquivo representa
  precipitation_mm float not null,
  fetched_at timestamptz default now(),
  unique(grid_lat, grid_lng, product, reference_time)
);

create index if not exists merge_cache_lookup
  on merge_cache(grid_lat, grid_lng, product, reference_time desc);
```

- **Indexação por célula de grade**: reaproveita a mesma função `gridCell()` de `lib/grid.ts` (grade de ~5km) já usada pra Open-Meteo — cada célula de bairro mapeia pra 1 índice de pixel do MERGE (grade de ~10km, então uma célula do Chuvarada sempre cai dentro de exatamente 1 pixel do MERGE, nunca precisa interpolar entre pixels).
- **Retenção**: `DAILY` — manter 4 dias (o suficiente pra somar `rain_72h` com folga). `HOURLY_NOW` — manter 4h (o suficiente pra calcular `rain_peak_3h`). Uma rotina de limpeza (`delete from merge_cache where product = 'daily' and reference_time < now() - interval '4 days'`, e equivalente pra `hourly_now` com 4h) evita crescimento indefinido — mesmo padrão de retenção que `scripts/sql/004_retention.sql` já implementa pra `risk_scores`.
- **Diferenciação DAILY/HOURLY_NOW**: coluna `product`, com constraint `check` — simples e explícito, sem ambiguidade na hora de somar/agregar.

---

## 4. Fluxo de atualização

Proposta de encaixe no cron de 20 minutos (`app/api/cron/update/route.ts`):

1. **MERGE busca em paralelo com a Open-Meteo**, não em série — não há motivo pra bloquear um pelo outro, já que alimentam variáveis diferentes do mesmo score.
2. **Arquivo `DAILY`**: buscar só **1x por dia**, não a cada ciclo de 20min — o CPTEC não publica um `DAILY` novo mais que 1x/dia mesmo. Proposta: o cron verifica se já tem o arquivo do dia corrente em `merge_cache`; se não tiver (ou se o último disponível ainda for de ontem, porque o de hoje ainda não foi publicado), tenta buscar; se conseguir, grava; se não, seguem os 2-3 dias anteriores já em cache.
3. **Arquivo `HOURLY_NOW`**: buscar **a cada ciclo do cron (20min)**, não a cada hora — porque o CPTEC pode demorar entre 0 e 60min pra publicar a hora corrente, e checar a cada 20min garante que a gente pega o arquivo assim que ele aparecer, sem esperar até 1h de atraso adicional. Isso é uma checagem barata (1 request HTTP HEAD ou GET por célula de grade única, não por bairro).
4. **Frequência combinada**: na prática, isso significa 1 tentativa de `DAILY` por dia + até 3 tentativas de `HOURLY_NOW` por hora (a cada 20min, até a hora aparecer) — bem mais leve que as ~2.500 chamadas de Open-Meteo por ciclo completo do cron, porque o MERGE é **por célula única compartilhada entre todas as cidades do Nordeste** (a mesma grade de 10km cobre todo o Nordeste de uma vez só — não precisa de 1 arquivo por cidade, é 1 arquivo pro Brasil/América do Sul inteiro por hora/dia).
5. **Latência de ~3,5h no `rain_peak_3h`**: isso significa que o "pico das últimas 3h" calculado com MERGE vai sempre refletir uma janela que termina ~3,5h atrás, não o instante presente. **Isso é aceitável dado o que a variável já representa hoje**: `rain_peak_3h` já foi desenhada pra capturar "um pico que aconteceu e já passou, mas ainda pesa no risco" (ver `lib/weather.ts`) — um atraso de 3,5h é uma degradação de frescor, não uma quebra conceitual da variável. A alternativa (manter só Open-Meteo pra isso) já demonstrou falhar exatamente no cenário que mais importa (evento intenso e localizado).

---

## 5. Estratégia de fallback

Proposta, espelhando o padrão já usado em `lib/weather.ts` pra fallback de cache expirado:

- **CPTEC fora do ar ou arquivo do período ainda não publicado**: usar o último `merge_cache` disponível, mesmo que tenha mais do que a janela ideal de atraso — melhor um dado de 6-8h atrás do que nenhum dado.
- **Limite de idade aceitável**: proponho **12h** pro `HOURLY_NOW` (acima disso, um "pico das últimas 3h" de 12h atrás deixa de ser informação útil sobre o risco *agora*) e **48h** pro `DAILY` (acima disso, a soma de 72h fica baseada em dado velho demais pra refletir o acumulado real recente).
- **Fallback final pra Open-Meteo**: se não houver nenhum `merge_cache` dentro desses limites, `rain_72h`/`rain_peak_3h` voltam a ser calculados só com Open-Meteo, exatamente como funciona hoje — o MERGE nunca deveria ser um *hard dependency* que derruba o cálculo de risco se o CPTEC cair.
- **Sinalizar no score que o dado é de fallback**: proponho um campo novo em `risk_scores`, algo como `rain_source text default 'open-meteo'` (valores: `'open-meteo'`, `'merge'`, `'merge-stale'`) — permite auditoria (por que esse score usou uma fonte ou outra) e dá material pra, futuramente, mostrar no painel de bairro "dado de precipitação: MERGE/CPTEC" ou "Open-Meteo" com um ícone diferente, sem inventar nada na interface agora.

---

## 6. Impacto no score — calculado com dado real (não estimado)

Baixei os 24 arquivos horários do MERGE pra 18/07/2026 e extraí a série real de precipitação em Pitimbú (Natal):

| Hora (UTC) | mm | Hora (UTC) | mm |
|---|---:|---|---:|
| 00h | 1,25 | 12h | 0,53 |
| 01h | 2,91 | 13h | 4,84 |
| 02h | 6,62 | 14h | 5,38 |
| 03h | 8,05 | 15h | 9,56 |
| 04h | 5,00 | 16h | 3,17 |
| 05h | 9,11 | 17h | 0,02 |
| 06h | 2,69 | 18h | 0,00 |
| **07h** | **9,35** | 19h | 0,05 |
| **08h** | **13,86** | 20h | 0,06 |
| 09h | 3,75 | 21h | 0,00 |
| 10h | 2,62 | 22h | 0,00 |
| 11h | 1,62 | 23h | 0,53 |

Maior janela de 3h consecutivas: **06h-08h, pico horário de 13,86mm** → `rain_peak_3h = 13,86mm`.
Soma das 72h (17-20/07): **127,94mm** → `rain_72h = 127,94mm`.

Valores reais de Pitimbú no banco: `terrain_slope = 0,2481`, `hydro_proximity = 0,8925`, `is_coastal = false`. Natal tem `tide_code` cadastrado, então `hasTide = true` pra todo bairro da cidade (mesmo os não-costeiros — é assim que `lib/score.ts` já funciona hoje, o `tide_code` é por cidade, não por bairro); `tide_level` real em cache: `0,5`.

**Cálculo completo, aplicando a fórmula exata de `lib/score.ts`:**

```
rain_peak_3h_norm = normalizeLinear(13.86, 10, 30)  = 0,5965
rain_1h_norm      = normalizeLinear(0, 25, 50)      = 0        (mantido da Open-Meteo — chuva já tinha parado no instante do cron real)
rain_72h_norm     = normalizeLinear(127.94, 50, 100) = 1,0000   (>= 100, satura no máximo)
terrain_slope     = 0,2481   (peso 15%)
hydro_proximity   = 0,8925   (peso 12%)
tide_level        = 0,5000   (peso 8%)

score = 0,5965×0,25 + 0×0,20 + 1,0×0,20 + 0,2481×0,15 + 0,8925×0,12 + 0,5×0,08
      = 0,1491 + 0 + 0,2000 + 0,0372 + 0,1071 + 0,0400
      = 0,5334
```

**Nível: score 0,5334 → "atenção"** (faixa 0,30-0,60) — **não crítico**, apesar do `rain_72h` estourado.

**Achado importante e honesto**: a regra de crítico automático #3 (`rain_72h > 100 AND rain_1h > 0`) **não dispara**, porque `rain_1h` (mantido da Open-Meteo, valor real do instante do cron) estava em **0** — a chuva já tinha parado quando o cron rodou naquele ciclo específico. As regras #1 (`rain_1h > 50`) e #2 (`tide_level > 0,8 AND is_coastal`) também não se aplicam (Pitimbú não é costeiro; maré em 0,5, não 0,8+).

**Conclusão**: a integração do MERGE **corrigiria Natal de "normal" (o que aconteceu de verdade, o bug original) para "atenção"** — uma melhora real e significativa — **mas não sozinha até "crítico"** pro nível de bairro nesse cálculo específico, porque a regra de auto-crítico #3 depende do valor instantâneo de `rain_1h`, que é uma limitação **separada** já conhecida (o mesmo padrão do diagnóstico original de "chuva que já passou não é vista pelo instante do cron") — mas que a regra #3, diferente do que a introdução do `rain_peak_3h` já resolveu pro score ponderado, ainda usa o valor bruto instantâneo, não o pico. **Isso não é escopo desta proposta de integração do MERGE** (é uma decisão sobre a regra #3 em si, que talvez devesse usar `rain_peak_3h` no lugar de `rain_1h`) — só estou reportando o resultado real do cálculo, sem alterar nada.

---

## 7. Mudanças necessárias no código (ainda não implementadas)

| Arquivo | Mudança |
|---|---|
| **`lib/merge.ts`** (novo) | Orquestra o fetch dos arquivos `DAILY`/`HOURLY_NOW`, calcula `rain_72h`/`rain_peak_3h` por célula, lê/grava `merge_cache`. Não estende `lib/cptec.ts` — são fontes com formatos totalmente diferentes (HTML scraping vs. GRIB2 binário), misturar não ajudaria a legibilidade. |
| **Script auxiliar Python** (novo, ex: `scripts/read_merge_grib.py`) | **Decisão técnica que precisa de validação antes de codificar**: GRIB2 não tem um parser maduro em Node/TypeScript. Nesta investigação, usei `rasterio`/GDAL via o Python embutido do projeto (`PYTHON_EMBED_PATH`, já usado por outros scripts do pipeline) pra ler os arquivos. A proposta é `lib/merge.ts` baixar o `.grib2` e invocar esse script Python via `execFileSync` (mesmo padrão já usado em scripts de pré-processamento), passando a lista de células de grade a extrair, recebendo JSON de volta. Ver riscos na seção 8. |
| **`scripts/sql/013_merge_cache.sql`** (novo) | Migração criando a tabela `merge_cache` (schema da seção 3). |
| **`scripts/sql/014_risk_scores_rain_source.sql`** (novo) | Migração adicionando `rain_source text default 'open-meteo'` em `risk_scores` (seção 5). |
| **`app/api/cron/update/route.ts`** | Adicionar a chamada a `lib/merge.ts` em paralelo à chamada de `getWeatherForPoint` (Open-Meteo), combinando os resultados antes de `calculateScore`. |
| **`lib/score.ts`** | **Nenhuma mudança na fórmula** — `calculateScore` já recebe `rain_72h`/`rain_peak_3h` como números normalizados de entrada; só troca de onde esses números vêm antes de chegar na função. A assinatura da função não muda. |
| **`types/index.ts`** | Adicionar `rain_source` em `RiskScore`; tipo novo `MergeCacheRow` espelhando a tabela. |

---

## 8. Riscos e limitações — honestos

- **GRIB2 em ambiente Node/serverless é o maior risco técnico real.** O Chuvarada ainda não foi implantado (deploy é item futuro, conforme `RELATORIO_COMPLETO.md`) — se o alvo de deploy acabar sendo uma função serverless (ex: Vercel Functions), rodar um subprocesso Python com GDAL dentro dela pode não ser viável (cold start pesado, binário GDAL precisaria estar empacotado na função, limites de tamanho de deployment). Isso **precisa ser decidido junto com a escolha de hospedagem**, não depois.
- **O CPTEC pode mudar a estrutura de pastas sem aviso** — é um FTP/diretório de pesquisa acadêmica, não uma API versionada com contrato formal. Não há SLA, changelog, ou aviso de depreciação conhecido. Mitigação parcial: o fallback pra Open-Meteo (seção 5) já cobre "o CPTEC sumiu"; não cobre "o CPTEC mudou o formato do arquivo silenciosamente" — isso quebraria a extração sem sinalizar erro claro, e precisaria de um teste de sanidade (ex: checar se o `.ctl` ainda bate com o schema esperado) antes de confiar num arquivo novo.
- **Latência de 3,5h**: como discutido na seção 4, é uma degradação aceitável pro que `rain_peak_3h` já representa — mas significa que o Chuvarada nunca vai "ver" um pico de chuva das últimas ~3,5h via MERGE; só Open-Meteo (que já demonstrou subestimar esse tipo de evento) cobre essa janela mais recente. Não existe solução que dê os dois ao mesmo tempo (dado bom E instantâneo) com as fontes gratuitas disponíveis hoje.
- **Cobertura confirmada**: grade cobre a América do Sul inteira (bounds testados: -120,05° a -20° lon, -60,05° a 32,3° lat) — o Nordeste brasileiro está com folga dentro dessa área, sem risco de ficar de fora.
- **E se o arquivo do dia ainda não estiver disponível quando o cron rodar?** Coberto pela seção 5 (fallback pro cache mais recente disponível, com limite de 48h/12h). Não testei quanto tempo depois da meia-noite UTC o `DAILY` do dia costuma aparecer — isso é algo a monitorar na prática antes de confiar cegamente no "1x por dia é suficiente".
- **Banda 2 (`NEST`) inconsistente**: como reportado na seção 1, não dá pra usar isso como indicador de confiança por pixel agora — a proposta não depende dela (usa só a banda 1), mas significa que não temos um jeito automático de saber "esse pixel específico tem pouca cobertura de pluviômetro, confie menos nele". Fica como limitação aceita, não bloqueadora.
- **Validação de um único evento**: todo o teste desta investigação foi feito contra 1 evento real (Natal, 18/07). É uma validação forte e direta, mas é 1 ponto de dado — vale observar mais alguns ciclos de chuva antes de considerar o MERGE "comprovadamente confiável" de forma geral, não só pra esse caso específico.

---

## 9. Comparação: MERGE vs. situação atual

| Aspecto | Atual (Open-Meteo) | Com MERGE |
|---|---|---|
| Fonte de `rain_72h`/`rain_peak_3h` | Modelo numérico global, grade ~25km | Satélite (IMERG) + pluviômetros do INMET, grade ~10km |
| Natal, evento 18/07 | ~30mm/72h (subestimado, o mapa ficou "normal" quando deveria alertar) | ~147mm/72h no centro da cidade, 128mm em Pitimbú (bate com a notícia de >100mm/12h) |
| Latência de `rain_72h` | ~0h (tempo real) | ~3,5h (aceitável pro que a variável já representa) |
| Cobertura geográfica | Global | América do Sul inteira — Nordeste com folga (confirmado) |
| Autenticação | Nenhuma | Nenhuma (confirmado nesta sessão) |
| Formato do dado | JSON, parse nativo em TS | GRIB2 — precisa de GDAL/Python, sem parser maduro em Node |
| Risco de mudança sem aviso | Baixo (API comercial com contrato, versionada) | Médio/Alto (FTP de pesquisa, sem SLA nem changelog conhecido) |
| Vento/umidade/pressão | Cobre | Não cobre (só precipitação) — Open-Meteo continua necessária de qualquer forma |
| Volume de chamadas no cron | ~2.500 células únicas por ciclo completo | 1 arquivo `DAILY`/dia + até 3 tentativas de `HOURLY_NOW`/hora, compartilhado entre toda a região |

---

## 10. Recomendação final

**Vale implementar, mas não agora — depois (ou em paralelo com) a decisão de onde o Chuvarada vai rodar em produção.** A validação com o evento de Natal é forte e concreta: o MERGE teria corrigido o "normal" errado pra "atenção" real, uma melhora genuína de confiabilidade. Mas a peça técnica que sustenta tudo isso (ler GRIB2 via subprocesso Python) tem uma dependência direta com uma decisão que este projeto ainda não tomou — onde e como ele vai ser hospedado. Implementar antes disso arrisca ter que refazer a abordagem de extração de dado se o ambiente de produção não suportar rodar Python/GDAL.

**Próximos passos concretos, se a resposta for seguir em frente:**
1. Decidir/confirmar o ambiente de hospedagem do cron em produção (serverless vs. servidor/container persistente) — isso determina se a abordagem "Node chama Python via subprocess" é viável ou se precisa de alternativa (ex: um microserviço Python separado só pra extração GRIB2, ou pesquisar se existe alguma lib WASM/pure-JS madura o suficiente pra GRIB2 até lá).
2. Rodar as migrações `013_merge_cache.sql` e `014_risk_scores_rain_source.sql`.
3. Implementar `lib/merge.ts` + o script auxiliar de extração, com teste manual contra o mesmo evento de Natal (18/07) já validado nesta investigação, comparando o valor extraído automaticamente com os números desta proposta (147mm/128mm) como caso de regressão.
4. Integrar no cron com o fallback da seção 5 desde o primeiro dia (não depois) — dado o histórico deste projeto de já ter passado por 2 incidentes de fonte de clima falhando (OpenWeatherMap sem histórico, Open-Meteo subestimando evento local), a integração nova deveria nascer com fallback, não ganhar um depois de quebrar.
5. Observar pelo menos mais 2-3 eventos de chuva reais (não sintéticos) rodando em paralelo com a Open-Meteo (sem ainda substituir o score de produção) antes de promover o MERGE de "fonte secundária observada" pra "fonte que efetivamente entra no cálculo" — validar 1 evento é forte, mas não é uma amostra estatística.

**O que precisaria ser validado antes de implementar**: a viabilidade de rodar GDAL/Python no ambiente de produção real (item 1 acima) é o único bloqueador de fato; o resto é trabalho de implementação direta sobre uma arquitetura já bem definida por esta proposta.
