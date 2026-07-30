# Como contribuir com o Chuvarada

Obrigada pelo interesse em contribuir! Este guia explica como configurar o
ambiente, entender a arquitetura e submeter mudanças.

## Pré-requisitos

- Node.js 20+ (versão usada no CI — ver `.github/workflows/`)
- Python 3.11+ (só para os scripts de pré-processamento geoespacial em `scripts/python/`)
- Conta no Supabase (gratuita)
- Conta no Backblaze B2 (gratuita)

## Configuração local

```bash
# 1. Clonar o repositório
git clone https://github.com/luarawork/chuvarada.git
cd chuvarada

# 2. Instalar dependências
npm install

# 3. Configurar variáveis de ambiente
cp .env.local.example .env.local
# Preencher os valores no .env.local

# 4. Rodar em desenvolvimento
npm run dev
```

## Rodando os testes

```bash
# Testes unitários e de regressão (Vitest) -- 39 testes hoje
npm test

# Modo watch
npm run test:watch

# Cobertura
npm run test:coverage
```

Não há testes E2E ainda (Playwright está listado em "Áreas que precisam de
contribuição" abaixo) — verificação de UI hoje é manual, no navegador.

## Estrutura do projeto

```
/app              — rotas Next.js (App Router)
/components       — componentes React
/lib              — lógica de negócio e integrações
/hooks            — hooks customizados
/types            — tipos TypeScript centralizados
/scripts
  /python         — scripts de produção (Python)
  /one-off        — scripts já executados (não rodar novamente, ver scripts/one-off/README.md)
  /sql            — migrações SQL (001-037)
/tests
  /unit           — testes unitários (Vitest)
  /regression     — testes de regressão de bugs críticos
  /e2e            — testes E2E (Playwright) -- ainda não existe, ver Roadmap
/docs
  /reports        — relatórios e diagnósticos
  /investigations — investigações de bugs
  /architecture   — decisões de arquitetura (ADRs)
/.github/workflows — GitHub Actions (5 workflows)
```

## Como o modelo de risco funciona

O Chuvarada calcula um score de 0 a 1 para cada bairro combinando 6 variáveis.
Os pesos abaixo são os mesmos em todo o país hoje (estrutura por região já
existe em `lib/scoreConfig.ts`, mas ainda não foi calibrada — ver
[ADR-004](docs/architecture/ADR-004-pesos-regionais-estruturados.md)):

| Variável | Peso | Fonte |
|---|---:|---|
| `rain_peak_3h` | 25% | MERGE/CPTEC |
| `rain_1h` | 20% | Open-Meteo |
| `rain_72h` | 20% | MERGE/CPTEC |
| `terrain_slope` | 15% | NASA SRTM |
| `hydro_proximity` | 12% | ANA/BHO |
| `tide_level` | 8% | CPTEC (fora do ar — sempre 0,5, ver [ADR-006](docs/architecture/ADR-006-salvaguarda-merge-estagnado.md) e a Wiki) |

Limiares: Normal < 0,30 | Atenção 0,30–0,60 | Crítico > 0,60

Veja [`lib/score.ts`](lib/score.ts) para as 3 regras de crítico automático e
a Wiki ([Score Model](https://github.com/luarawork/chuvarada/wiki/Score-Model))
para a validação com eventos reais.

## Política de contribuição

### Todo bug corrigido ganha um teste de regressão

Antes de abrir um PR corrigindo um bug, escreva um teste que reproduza o bug
em `tests/regression/critical-bugs.test.ts`. O teste deve falhar antes da
correção e passar depois.

### Decisões arquiteturais importantes precisam de ADR

Se sua mudança alterar uma decisão de arquitetura significativa (ex: trocar
uma fonte de dados, mudar a estratégia de cache, alterar o modelo de risco),
crie um ADR em `docs/architecture/`. Veja os exemplos existentes (ADR-001 a
ADR-007).

### Convenções de commit

Seguimos o padrão [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` nova funcionalidade
- `fix:` correção de bug
- `perf:` melhoria de performance
- `refactor:` refatoração sem mudança de comportamento
- `test:` adição ou correção de testes
- `docs:` documentação
- `chore:` tarefas de manutenção

### Nunca fazer sem aprovação

- Alterar os pesos do modelo de risco
- Mudar os limiares de score (0,30/0,60)
- Deletar dados do banco de produção
- Mudar a política de retenção de dados

## Áreas que precisam de contribuição

- 🌊 Dados de maré — CPTEC degradado, integração com WorldTides já estruturada em `lib/worldtides.ts`, falta só a chave de API
- 🗺️ Shapefiles de bairro para SP/Campinas/Sorocaba (o Censo 2022 do IBGE não tem `NM_BAIRRO` pra essas cidades)
- 🔬 Calibração dos pesos do modelo por região (requer expertise em hidrologia/meteorologia)
- 🧪 Testes E2E com Playwright
- 🌐 Integração com INMET (API horária, requer token)

## Dúvidas?

Abra uma issue ou use o botão "Sugerir melhoria" no próprio app.
