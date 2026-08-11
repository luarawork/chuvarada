# Ecossistema de Produtos Climáticos

## Contexto
Definições estabelecidas em agosto/2026 durante sessões
de desenvolvimento do Chuvarada.

## Missão

> "Traduzir dado climático em risco humano, na escala do
> bairro, para qualquer pessoa no Brasil."

## Princípio central

Não monitorar o clima — isso já existe (INPE, CEMADEN,
INMET, Climatempo). Monitorar como o clima impacta a
vida das pessoas.

## Produtos planejados

| Produto | Fenômeno | Pergunta que responde |
|---|---|---|
| 🌧️ Chuvarada | Chuva, enchente, alagamento, deslizamento | "Meu bairro vai alagar?" |
| 🔥 Produto 2 | Queimadas + qualidade do ar | "O ar está comprometido?" |
| 💧 Produto 3 | Seca + desabastecimento | "Pode faltar água?" |
| 💨 Produto 4 | Vento extremo (em avaliação) | "Há risco de vento perigoso?" |

## Calor extremo — descartado como produto isolado

Monitorar temperatura é monitorar clima, não impacto.
Calor extremo pode entrar como variável em Queimadas
(calor seco aumenta risco de incêndio).

## Arquitetura do ecossistema

Produtos independentes com URLs separadas (.vercel.app),
compartilhando:
- Malha de bairros (neighborhoods, cities)
- Autenticação (usuários, favoritos)
- Design system (shadcn/ui, mesma paleta)

Cada produto tem seu próprio banco de scores e crons.

## Site agregador

Planejado quando houver 2-3 produtos maduros.
Mostraria todos os riscos ativos do bairro em um painel.

## Status

Chuvarada: em produção
Demais produtos: não iniciados
