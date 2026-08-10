# Changelog

Todas as mudanças significativas do Chuvarada são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/).

---

## [Não lançado]

### Planejado

- Testes E2E com Playwright
- Calibração de pesos do modelo por região (`lib/scoreConfig.ts`, hoje idênticos em todo o país)
- Completar o rollout do TideCheck pras 115 cidades costeiras (32 já com estação atribuída — ver [1.1.0] e [ADR-009](docs/architecture/ADR-009-tidecheck-integration.md))

---

## [1.2.0] — pós-lançamento (até 09/08/2026)

### Adicionado

- Score recalibrado pra escala 1–10 com 5 níveis (Normal/Atenção/Moderado/Alto/Crítico), substituindo a escala anterior de 0–1 com 3 níveis
- Desvio da média histórica (climatologia) exibido no DetailPanel — contextualiza a chuva 72h atual contra a média do mesmo período em anos anteriores (`lib/climatology.ts` + `/api/climatology`)
- Dois monitors de GitHub Actions (health-monitor, quality-monitor), com labels próprias no GitHub pra triagem de issues automáticas
- Migração completa da UI pra shadcn/ui (Button, Badge, Card, Input, Select, Tabs, ToggleGroup, Switch, Label, Popover, Separator, ScrollArea, Toast) — tema escuro via CSS variables em `:root`, componentes hand-authored (CLI `shadcn@latest` incompatível com os tokens já em uso)
- Redesign completo de `/como-funciona` — hero + 7 seções numeradas (fontes de dados, cálculo do score, níveis de risco, previsão de 7 dias, relatos da comunidade, limitações honestas, instalação PWA) + CTA final, hierarquia tipográfica e espaçamento consistentes com o design system shadcn/ui

### Alterado

- Modo padrão do mapa trocado pra Voyager (claro)
- Toggle de camada renomeado pra "Modo Escuro/Claro" (era Padrão/Rua); tile escuro trocado pro CartoDB dark_all (gratuito, com ruas visíveis)
- `maxZoom` 18 nos dois modos de mapa
- Cores de Atenção (`#ffe066`) e Moderado (`#d95f02`) com maior contraste
- Archiving pro B2 rodando 2x/dia (era 1x), lock com TTL de 20min, índice único anti-duplicatas

### Corrigido

- `maxDuration` do Cron A reduzido de 570 para 300s — limite do plano Hobby da Vercel
- 3 bugs de UI mobile: scroll do DetailPanel travado, z-index do dropdown de busca, banner de alerta muito alto (bottom-32)
- "Sem bairro ainda" removido da legenda do mapa — texto não correspondia a nenhum estado real do dado
- Limpeza emergencial do banco (Supabase acima de 135% do limite do plano)

### Segurança

- Hardening do Supabase: REVOKE de privilégios desnecessários, `search_path` fixado em funções, senha mínima de 8 caracteres

---

## [1.1.0] — pós-lançamento (até 08/08/2026)

### Corrigido

- `select *` / `n.*` quebrando após a migração 032 remover `neighborhoods.geometry` — centenas de cidades com score congelado
- Cron B com o mesmo bug de `select *` — 604 cidades com `weather_cache` desatualizado (3-5 dias)
- Regra 3 de crítico automático aceitando ruído de sensor (0,05mm) como chuva real — limiar elevado de 0 para 1mm
- `getAlignment`: combinação Crítico+Grave aparecia como "Diverge levemente" em vez de "Alinha"
- Lock de escrita não atômico entre o cron do MERGE e o cron de scores — corrigido via `INSERT ... ON CONFLICT`
- `archive_to_b2`: teto fixo por execução insuficiente para o volume atual (loop até drenar o backlog) + proteção de leitura-antes-de-gravar em `risk_scores`
- `RETURNING id` desnecessário removido do UPSERT de `merge_cache` (usa `row_count` do driver via protocolo simples do pg8000)
- Centroide incorreto de Goiabeiras/Vitória-ES
- `rainLabel` (`HourlyForecast.tsx`): chuva fraca real (0,1-0,49mm) aparecia como "0mm" — decisão de unidade usava o valor bruto enquanto o número exibido já tinha sido arredondado
- Métricas de `/analise`: "Cobertura de dados" media `data_level='full'` (10 de 5.570 cidades, ~0%) enquanto a tabela expandida do mesmo card mostrava ~100% (`pct_com_score`) — unificado pra medir a mesma coisa nos dois lugares; "Taxa média de confirmação" mostrava percentual mesmo com 1 único relato — agora exige 5+ relatos com reação, senão mostra "—"
- Previsão de risco de 7 dias (`/api/forecast/[neighborhoodId]`) usava `tide_level` fixo em 0,5 pras cidades costeiras, ignorando o dado real do TideCheck que o score ao vivo já usa desde a integração abaixo
- 2 relatos de teste (bairro Graças/Recife, criados em sequência com 28s de diferença) deletados da produção
- `city_risk_summary`, `cron_run_stats`, `merge_cache_cells` e `system_locks` ganharam policy de RLS explícita de negação — comportamento (deny-all via REST) não mudou, só deixou de depender implicitamente de "zero policies = nega", seguindo o padrão já usado em `system_locks`/`cron_run_stats` desde a correção do achado C1 (ver migração `039_explicit_deny_policies.sql`)

### Adicionado

- `hydro_proximity` reprocessado nacionalmente com ordem de Strahler (28.483 bairros, 27 estados + DF) — saturação em ~1,0 caiu de ~99% para 0,1% (ver [ADR-008](docs/architecture/ADR-008-strahler-hydro-proximity.md))
- TideCheck API integrada como fonte de dado de maré em tempo real, substituindo o fallback neutro do CPTEC/INPE (degradado desde 2018) — 115 cidades costeiras cadastradas, 32 já com estação atribuída (9 UHSLC real + 23 FES2022 modelo), cota gratuita de 50 requisições/dia (ver [ADR-009](docs/architecture/ADR-009-tidecheck-integration.md))
- Hidrografia local integrada: Paraíba/AESA (168 de 3.872 bairros melhoraram) e Minas Gerais/IGAM (46 de 3.872 bairros melhoraram) — combinada com o BHO nacional via `max()`, não regressiva
- 9 testes de regressão novos (`rainLabel` e métricas de `/analise`) — suíte sobe de 39 para 48 testes
- ADR-009 (TideCheck) formalizado, completando a série ADR-001 a ADR-009

### Documentação

- Diagnósticos de variáveis estruturais (saneamento/Censo 2022, IVS/IPEA, impermeabilização/Mapbiomas) investigados como possível causa da subestimação de Santa Maria/RS — três descartados, um confirmou a causa raiz do `hydro_proximity` saturado (ver relatórios em `docs/reports/`)
- Investigação do raio fixo de 22km do `hydro_proximity` — concluída, raio adequado (não é problema)

---

## [1.0.0] — Lançamento inicial

### Adicionado

- Cobertura nacional: 27 estados (inclui DF), 5.570 municípios, 28.483 bairros/distritos
- Modelo de risco com 6 variáveis e estrutura de pesos regionais por estado
- MERGE/CPTEC como fonte principal de precipitação (`rain_72h`, `rain_peak_3h`)
- Open-Meteo como fonte de variáveis secundárias (`rain_1h`, vento, umidade, pressão), com WeatherAPI.com como fallback de emergência
- Backblaze B2 para archiving histórico
- Sistema de relatos de usuários com confirmação/negação e expiração automática
- Previsão de risco para os próximos 7 dias no DetailPanel
- Página `/analise` com comparação relatos vs modelo
- Página `/perfil` com favoritos, relatos e sugestões do usuário
- Seletor de camadas Modo Padrão / Modo Rua
- Notificações push (subscribe/send, service worker, toggles em `/perfil`)
- PWA instalável (Android e iOS confirmado)
- 5 GitHub Actions operacionais (MERGE + scores, clima, archiving pro B2, monitoramento de banco, cache de neighborhoods)

### Modelo de risco

- Limiares: Normal < 0,30 | Atenção 0,30–0,60 | Crítico > 0,60
- 3 regras de crítico automático:
  1. `rain_1h > 50mm`
  2. Maré alta (>80%) + chuva em zona costeira — **inativa** (CPTEC degradado, `tide_level` sempre neutro)
  3. `rain_72h > 100mm` E `rain_1h > 1mm`
- Pesos regionais estruturados em `lib/scoreConfig.ts` (calibração futura, hoje idênticos em todas as 5 regiões)

### Arquitetura

- Cron A (scores): lê cache de `merge_cache`/`weather_cache`, calcula 28.483 bairros/hora, sem nenhuma chamada externa
- Cron B (weather): atualiza `weather_cache` em lotes, com TTL variável (24h seco / 3h chuva ativa)
- Archiving diário para B2 (`risk_scores` >48h, `merge_cache` >4d/1d por proximidade, `weather_cache` >24h)
- Salvaguarda para MERGE estagnado (`last_changed_at`, >24h sem mudança de rain_72h/rain_peak_3h)
- Cache de neighborhoods no B2 (~2MB, regenerado 1x/dia via GitHub Action, vs ~8,76MB direto do banco por hora)

### Segurança

- RLS em todas as tabelas sensíveis
- Rate limiting por IP (3/hora anônimo, 10/hora autenticado nos endpoints de relato/sugestão)
- Endpoints de cron: fail-closed + comparação timing-safe do secret
- Headers de segurança (X-Frame-Options, HSTS, etc.)

### Fontes de dados integradas

- MERGE/CPTEC: precipitação nacional
- Open-Meteo + WeatherAPI.com: variáveis secundárias
- NASA SRTM (via OpenTopography): altimetria
- ANA/BHO: hidrografia nacional
- IBGE Censo 2022: malha de bairros
- Hidrografia local: Recife, Sergipe, Paraíba, Minas Gerais — integradas (ver [1.1.0])

### Bugs corrigidos (pós-lançamento)

- `select *` / `n.*` quebrando após a migração 032 remover `neighborhoods.geometry` — centenas de cidades com score congelado
- Cron B com o mesmo bug de `select *` — cidades com `weather_cache` desatualizado
- Regra 3 de crítico automático aceitando ruído de sensor (0,05mm) como chuva real
- Gráfico de histórico usando `score` em vez de `level` pra colorir pontos — escondia casos de crítico automático com score moderado
- MERGE estagnado (caso Naviraí/Itaquiraí/MS) — `last_changed_at` implementado como salvaguarda
- `getAlignment`: combinação Crítico+Grave aparecia como "Diverge levemente" em vez de "Alinha" — trocado por mapeamento explícito de pares
- Lock de escrita não atômico entre o cron do MERGE e o cron de scores — corrigida a race condition
- Limite de 1000 linhas do PostgREST em `/api/neighborhoods` — resolvido carregando por viewport (bbox) em vez da tabela inteira
