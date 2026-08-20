# Princípios de Design do Chuvarada

## Missão

> "Traduzir dado climático em risco humano, na escala do
> bairro, para qualquer pessoa no Brasil."

## Princípios fundamentais

### 1. Impacto na vida, não monitoramento climático
Não monitoramos o clima — isso já existe (INPE, CEMADEN,
INMET, Climatempo). Monitoramos como o clima impacta
a vida das pessoas no seu bairro.

**Na prática:**
- "Vai chover 80mm amanhã" → monitoramento climático ❌
- "Seu bairro está em risco agora" → impacto na vida ✅

### 2. Falar com o cidadão comum
O produto é para qualquer pessoa, não para especialistas.
Toda informação técnica deve ser traduzida em linguagem
acessível sem perder a precisão.

**Na prática:**
- Termos técnicos sempre acompanhados de explicação
- Score numérico + nível + cor (redundância intencional)
- Desvio histórico em % ("829% acima da média") em vez
  de z-score ou desvio padrão

### 3. Não causar terror desnecessário
O produto deve gerar ação, não ansiedade.
Alertas devem ser proporcionais ao risco real.

**Na prática:**
- 5 níveis com linguagem progressiva (Normal → Crítico)
- Regras automáticas só para eventos genuinamente extremos
- Aviso de incerteza crescente na previsão de 7 dias
- Nunca usar linguagem de evacuação sem base técnica validada

### 4. Transparência sobre limitações
O modelo é uma aproximação, não a verdade.
As limitações devem estar visíveis, não escondidas.

**Na prática:**
- Seção "Limitações honestas" em destaque no /como-funciona
- Aviso explícito na previsão ("incerteza aumenta com o tempo")
- Pesos sem calibração regional documentados como pendência
- "Sempre consulte a Defesa Civil para decisões de segurança"

### 5. Dado vivido complementa dado calculado
O relato de quem está no local é o sensor mais granular
que existe. O modelo aprende com o que as pessoas reportam.

**Na prática:**
- Relatos como validação do modelo, não substituto
- Quando relatos e modelo divergem, é dado — não erro
- Santa Maria/RS: 3.25mm abaixo do limiar, evacuação real
  → o dado vivido teria capturado o que o modelo perdeu

### 6. SDD como abordagem de desenvolvimento
Especificação antes de construção. Quanto mais pensamos
e aprofundamos as specs, melhor o produto resultante.

**Na prática:**
- Spec detalhada antes de pedir implementação à IA
- Artefatos de UX Research alimentam diretamente as specs
- A IA amplifica o que você já sabe — não substitui o entendimento
- Spec atualizada conforme o projeto evolui

## Decisões de design — registro histórico

### Score e níveis de risco
- **Escala:** 1-10 (migrado de 0-1 em agosto/2026)
- **5 níveis:** Normal (1-2.9) / Atenção (3-4.9) /
  Moderado (5-6.4) / Alto (6.5-7.9) / Crítico (8-10)
- **Cores:** Verde / Amarelo (#ffe066) / Laranja (#d95f02) /
  Vermelho / Roxo
- **Rationale:** 3 níveis era insuficiente — coisas moderadas
  caíam em Crítico sem distinção real de urgência

### Granularidade: bairro
- Não rua (dado não existe publicamente)
- Não município (muito amplo para ser útil)
- Bairro: menor unidade disponível via IBGE Censo 2022

### Previsão: 7 dias
- Limitação de banco de dados
- Incerteza crescente com o tempo
- Dados do Open-Meteo (previsão, não observação)
- Nunca substituir alertas oficiais

### Regras automáticas
- Regra 1: rain_1h > 50mm → Crítico
- Regra 2: maré alta + chuva em zona costeira → Crítico
- ~~Regra 3: rain_72h > 100mm + rain_1h > 1mm → Crítico~~
  Removida em agosto/2026 — soil_moisture captura a
  saturação do solo de forma mais precisa e proporcional

### Mapa
- Modo Claro (Voyager) como padrão — mais legível ao sol
- Modo Escuro (CartoDB dark_all) como opção
- maxZoom: 18 nos dois modos (limite da fonte vetorial)
- Toggle: só ícone (🌙/☀️) com tooltip

### Biblioteca de componentes
- shadcn/ui + Radix UI (agosto/2026)
- Tailwind como base de estilização
- Componentes copiados para o projeto (não dependência)
- Tema escuro como padrão absoluto (não toggle de usuário)

## O que este produto não faz

- Não substitui alertas oficiais da Defesa Civil
- Não instrui evacuação (sem validação técnica para isso)
- Não monitora clima (só impacto na vida das pessoas)
- Não tem precisão de rua ou endereço
- Não cobre infraestrutura de drenagem (dado inexistente)
