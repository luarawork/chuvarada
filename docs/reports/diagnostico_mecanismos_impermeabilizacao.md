# Diagnóstico — Mecanismos de Alagamento e Impermeabilização

Diagnóstico apenas — nada foi integrado ao modelo. Cobre as duas hipóteses levantadas na conversa com a bióloga.

---

## A. Distinção alagamento urbano vs inundação fluvial

### Classificação atual dos bairros (heurística proposta: `hydro_proximity`/`terrain_slope`)

| Mecanismo provável | Bairros | `hydro_proximity` médio | `terrain_slope` médio |
|---|---|---|---|
| inundação fluvial (hydro>0,7 e slope<0,3) | 12.287 (43%) | 0,963 | 0,216 |
| alagamento urbano (slope<0,2 e hydro<0,4) | **150 (0,5%)** | 0,202 | 0,152 |
| misto | 16.046 (56%) | 0,964 | 0,508 |

Nenhum bairro tem `hydro_proximity`/`terrain_slope` nulo (28.483/28.483 preenchidos).

### Achado principal: a heurística não discrimina bem, porque `hydro_proximity` está saturado

99,5% dos bairros do Brasil caem em "inundação fluvial" ou "misto" — só 150 bairros (0,5%) ficam no perfil "alagamento urbano" puro. Isso não é porque o Brasil é mesmo assim — é porque `hydro_proximity` já vem próximo de 1,0 (0,96 em média) pra quase todo bairro urbano do país, dado que a hidrografia brasileira é densa e o cálculo mede distância até *qualquer* curso d'água, não especificamente até um rio com capacidade real de transbordar. Com o valor bruto já perto do teto pra quase todo mundo, o limiar de 0,7 escolhido na hipótese separa muito pouca coisa de verdade.

### Os casos validados batem com o mecanismo esperado?

**Não, e nos dois sentidos.**

**Natal (evento documentado como "alagamento urbano", 17 pontos de rua alagada por chuva intensa, sem menção a transbordamento de rio)** — dos 12 bairros citados no evento real, a heurística classifica:
- 7 como `inundacao_fluvial` (Alecrim, Pajuçara, Petrópolis, Planalto, Quintas, Ribeira, Tirol)
- 4 como `misto` (Areia Preta, Candelária, Neópolis, Ponta Negra)
- só 1 como `alagamento_urbano` (Cidade da Esperança)

Ou seja: o evento que a própria documentação do projeto descreve como alagamento urbano é classificado pela heurística majoritariamente como inundação fluvial — o oposto do esperado.

**Santa Maria/RS (evento documentado como inundação fluvial real — Rio Vacacaí-Mirim transbordou, evacuação de bairros)** — os bairros historicamente citados na evacuação (João Goulart, Km 3, Campestre do Menino Deus — nomes reais no banco: "Presidente João Goulart", "Km Três", "Campestre do Menino Deus") são classificados como **`misto`**, não `inundacao_fluvial`, porque o `terrain_slope` deles (0,32–0,63) passa do limiar de 0,3 da heurística, apesar do `hydro_proximity`=1,0 nos três.

Conclusão: a heurística baseada nesses 2 limiares fixos não reproduz os mecanismos reais nem no caso de alagamento urbano nem no de inundação fluvial documentados. O problema não é só o limiar escolhido — é que `hydro_proximity`, do jeito que é calculado hoje, não separa "perto de um rio que pode transbordar" de "perto de qualquer curso d'água urbano", então nenhum par de limiares vai funcionar bem em cima dele.

### Os pesos atuais fazem sentido? (`lib/scoreConfig.ts`)

Pesos reais hoje (iguais nas 5 regiões): `rain_peak_3h`=0,25, `rain_1h`=0,20, `rain_72h`=0,20, `terrain_slope`=0,15, `hydro_proximity`=0,12, `tide_level`=0,08.

Dado que `hydro_proximity` já está saturado (~0,96) pra 99% dos bairros, o peso de 12% dele contribui um valor quase constante pra quase todo mundo — **subir ou descer esse peso não muda muito o comportamento do modelo enquanto o dado bruto não discriminar melhor entre bairros**. Ou seja, mesmo que a hipótese da bióloga (pesos diferentes por mecanismo) estivesse certa, ajustar o peso de `hydro_proximity` sozinho não teria o efeito esperado — o gargalo real está em como a variável é calculada, não no peso dela.

`rain_peak_3h` (25%, o maior peso) já favorece o mecanismo de alagamento urbano por padrão (chuva intensa concentrada), o que é consistente — Natal, o caso de alagamento urbano confirmado, foi capturado corretamente sem precisar de ajuste.

### Recomendação (A)

Não mexer nos pesos por mecanismo agora. Antes de qualquer recalibração, o item que precisaria de trabalho real é a própria variável `hydro_proximity` — hoje ela mede proximidade a "qualquer curso d'água" no BHO/ANA, sem distinguir porte/capacidade de vazão do curso d'água. Sem essa distinção, qualquer heurística de mecanismo (inclusive uma futura, com limiares recalibrados) vai continuar classificando mal casos como o de Santa Maria e Natal.

---

## B. Impermeabilização do solo (Mapbiomas)

### Dados encontrados

Nenhuma das duas URLs sugeridas funcionou (ambas 404 — o Mapbiomas reorganizou as pastas de download desde então). O caminho real: `brasil.mapbiomas.org/en/estatisticas/` → **"Biomas, Estados e Municípios (Coleção 10.1) — Cobertura"**, hospedado no Google Drive (`drive.usercontent.google.com`, não no bucket público do Google Cloud Storage citado no pedido).

- Arquivo: `cobertura_municipios.xlsx` (79 MB) — 78.818 linhas, 1 linha por (município, bioma, classe de uso do solo), anos 1985–2024.
- Classe usada: **`class_id = 24`**, chamada oficialmente **"4.2. Área Urbanizada" / "Urban Area"** (o pedido chamava de "Infraestrutura Urbana" — nome real é esse, mesmo conceito: edificação, asfalto, concreto).
- Ano usado: **2024** (o mais recente disponível).

### Cobertura

**5.566 de 5.570 municípios do Chuvarada (99,9%)** batem por nome+estado exato. As 4 exceções: Fernando de Noronha/PE (distrito estadual, não município regular — não existe nas estatísticas do IBGE/Mapbiomas como município comum), Barão do Monte Alto/MG, Unas/BA, Graccho Cardoso/SE (provavelmente pequenas diferenças de grafia entre as duas fontes). Cobertura excelente — bem melhor que os 895/5.570 do Censo por bairro do diagnóstico anterior, porque aqui a granularidade já é município (a mesma do Mapbiomas), sem precisar agregar.

### Correlação com os casos validados

| Município | % Área Urbanizada (Mapbiomas 2024) | Mecanismo real | Modelo acertou? |
|---|---|---|---|
| Natal/RN | **61,9%** | Alagamento urbano | ✅ Acertou |
| Recife/PE | **57,3%** | Alagamento urbano (referência histórica) | ✅ Acertou |
| Porto Alegre/RS | **38,2%** | Misto | ✅ Acertou |
| Vanini/RS | 1,4% | Inundação fluvial | ✅ Acertou |
| **Santa Maria/RS** | **3,6%** | Inundação fluvial (Vacacaí-Mirim) | ❌ **Subestimou** |

### Hipótese confirmada?

**Refutada — e de forma esclarecedora.** A hipótese era "alta impermeabilização + chuva moderada alaga mais do que o modelo prevê, porque a água não infiltra". Só que Santa Maria — o único caso real de subestimação — tem a **segunda menor** taxa de impermeabilização de todo o grupo (3,6%, atrás só de Vanini com 1,4%). As duas cidades onde o modelo mais claramente acertou por padrão urbano intenso (Natal e Recife) têm impermeabilização 15-17× maior.

Isso na verdade **confirma** o que já se sabia sobre a causa raiz de Santa Maria: foi um transbordamento de rio de verdade (evento fluvial, não escoamento superficial urbano), num município pouco impermeabilizado — exatamente o cenário onde impermeabilização não é a variável relevante. O miss ali foi puramente meteorológico (`rain_72h` ficou ~3mm abaixo do limiar de 100mm da Regra 3), não estrutural.

### Recomendação (B)

**Não integrar agora — nem como variável, nem como badge.** A hipótese que motivou a investigação não se sustenta nos casos disponíveis; ao contrário, o dado reforça que o mecanismo dominante em Santa Maria é fluvial (baixíssima impermeabilização), não de escoamento urbano. Isso não significa que impermeabilização seja inútil pro Chuvarada — a cobertura de 99,9% dos municípios é excelente, bem melhor que a do diagnóstico de saneamento — mas não há evidência hoje de que ela explique algum erro real do modelo. Vale guardar o dado processado (`impermeabilizacao_por_municipio.csv`) caso apareçam mais casos de subestimação em áreas muito impermeabilizadas no futuro — aí sim valeria testar de novo com uma amostra maior.

---

## Síntese das duas hipóteses

Nenhuma das duas explica o único erro real conhecido do modelo (Santa Maria). O padrão que emerge dos dois diagnósticos, junto com o de saneamento/IVS da rodada anterior, é consistente: **Santa Maria é, em todas as variáveis estruturais medidas até agora (saneamento, IVS, impermeabilização), uma cidade "normal" ou até "menos vulnerável" que as demais do grupo — o que a diferencia foi puramente a intensidade real da chuva ficar perto o suficiente do limiar pra escapar da Regra 3.** Isso é, na verdade, uma boa notícia: não há sinal de que falte alguma variável estrutural grande no modelo — o ajuste mais direto continua sendo o que já está no Roadmap (revisar se o limiar de 100mm da Regra 3 está calibrado certo pra bacias urbanas pequenas do Sul), não uma nova fonte de dado.

## Notas de execução

- `dados-brutos/mapbiomas/cobertura_municipios.xlsx` (79 MB) e `impermeabilizacao_por_municipio.csv` processado ficaram salvos localmente, não versionados.
- Downloads brutos desta e das duas rodadas de diagnóstico anteriores (saneamento/IVS) somam ~720 MB em `dados-brutos/`, não commitados — vale limpar se não forem reusados.
