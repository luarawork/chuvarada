# Changelog

Todas as mudanças significativas do Chuvarada são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/).

---

## [Não lançado]

### Planejado

- Dados de maré em tempo real (WorldTides — estrutura pronta em `lib/worldtides.ts`, falta só a chave de API)
- Testes E2E com Playwright
- Calibração de pesos do modelo por região (`lib/scoreConfig.ts`, hoje idênticos em todo o país)

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
- Hidrografia local: Recife, Sergipe — integradas; Paraíba — baixada, não integrada

### Bugs corrigidos (pós-lançamento)

- `select *` / `n.*` quebrando após a migração 032 remover `neighborhoods.geometry` — centenas de cidades com score congelado
- Cron B com o mesmo bug de `select *` — cidades com `weather_cache` desatualizado
- Regra 3 de crítico automático aceitando ruído de sensor (0,05mm) como chuva real
- Gráfico de histórico usando `score` em vez de `level` pra colorir pontos — escondia casos de crítico automático com score moderado
- MERGE estagnado (caso Naviraí/Itaquiraí/MS) — `last_changed_at` implementado como salvaguarda
- `getAlignment`: combinação Crítico+Grave aparecia como "Diverge levemente" em vez de "Alinha" — trocado por mapeamento explícito de pares
- Lock de escrita não atômico entre o cron do MERGE e o cron de scores — corrigida a race condition
- Limite de 1000 linhas do PostgREST em `/api/neighborhoods` — resolvido carregando por viewport (bbox) em vez da tabela inteira
