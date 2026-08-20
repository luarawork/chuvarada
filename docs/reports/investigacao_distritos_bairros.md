# Investigação — Distritos vs Bairros no Mapa

**Data:** agosto/2026
**Trigger:** usuário reportou município amarelo no zoom afastado mas sem bairros ao aproximar (São Paulo de Olivença/AM)

---

## O problema identificado

### Origem

O Chuvarada usa a malha de bairros do IBGE Censo 2022. Para municípios sem shapefile de bairro completo, o IBGE usa distritos administrativos como unidade territorial — e o Chuvarada herdou esse fallback, tratando distritos como se fossem bairros.

### A escala do problema

- **855 municípios** têm bairros reais E distritos misturados.
- **821 de 855 (96%)** têm distritos com área média >10× maior que os bairros reais do mesmo município.
- Casos extremos na Amazônia: Tapauá/AM tem distrito cobrindo área maior que vários países europeus.

### Por que isso é problemático

**1. Visual no mapa**

Um distrito de 350km² (São Paulo de Olivença) aparece no zoom de bairro sobrepondo os 9 bairros urbanos reais. O usuário vê o município amarelo, aproxima, e encontra um polígono gigante que não representa nenhum bairro real.

**2. Score distorcido**

O centroide do distrito é calculado geometricamente no centro do polígono — que pode estar 100km+ da área urbana real. O clima e score calculados para esse ponto não representam nem a cidade nem a área rural de forma útil.

**Exemplo: São Paulo de Olivença/AM**

- 9 bairros reais (cluster urbano em ~-3.46, -68.9x).
- 2 distritos com centroides em (-3.63, -69.47) e (-4.50, -69.45).
- Distrito "São Paulo de Olivença": bbox de ~350km × 200km.
- Fator de distorção: 15.082× a área média dos bairros reais.

---

## O que NÃO fazer (opções descartadas)

### ❌ Não renderizar distritos no zoom de bairro

Deixaria áreas rurais sem cor — pareceria que não há dados. Municípios como São Paulo de Olivença têm pessoas nos distritos — ignorar é subestimar onde há gente.

### ❌ Mostrar só o nível de município no zoom aproximado

Um município como Tapauá/AM tem área maior que vários países europeus. Mostrar score único para esse território é enganoso — a realidade hídrica varia enormemente.

### ❌ Excluir distritos onde existem bairros reais

Remove cobertura legítima de áreas rurais onde pessoas vivem. São Paulo (capital) usa distritos administrativos — ignorar distritos em São Paulo seria ignorar a cidade inteira.

---

## A decisão: mostrar o dado pelo que ele é

### Princípio

- Onde o IBGE mapeou como **bairro** → score do bairro.
- Onde o IBGE mapeou como **distrito** → score do distrito.
- Não fingir que distrito é bairro.
- Não ignorar distrito porque é grande.
- Ser honesto sobre a granularidade disponível.

### O problema restante: centroide errado

O centroide geométrico de um polígono de 350km² não representa onde as pessoas vivem. O score calculado para esse centroide não tem significado real.

### Solução aprovada: centroide ponderado pela população

Usar os Agregados por Setores Censitários do Censo 2022 (IBGE, público, gratuito) para calcular o centroide ponderado pela população de cada distrito.

**Como funciona:**

```
Para cada distrito com centroide suspeito:
  1. Baixar setores censitários que intersectam o polígono
  2. Para cada setor: população + centroide do setor
  3. Centroide ponderado = média(lat, lng) ponderada por população
  4. Resultado: coordenada onde as pessoas realmente vivem
```

### Por que é a solução correta

- O score passa a ser calculado para onde há concentração populacional real, não o centro geométrico do polígono.
- Para distritos predominantemente rurais com poucos habitantes, o centroide vai naturalmente para a sede distrital.
- Para distritos com área urbana expressiva, vai para o centro de massa populacional.

### Fonte de dados

- Malha de Setores Censitários 2022 (shapefile/gpkg por estado).
- Agregados por Setores Censitários 2022 (população por setor).
- Disponível em: `ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/`.
- Mesmo processo já usado para processar bairros (BHO, SRTM).

---

## Mudanças visuais necessárias (além do centroide)

### Diferenciar visualmente bairro de distrito no mapa

**Bairro real (`name_source = 'bairro'`)**:
- Borda normal.
- Opacidade normal.
- DetailPanel: comportamento atual.

**Distrito (`name_source = 'distrito'`)**:
- Borda tracejada ou mais suave.
- Opacidade levemente menor.
- DetailPanel: aviso "Área distrital — dados menos granulares que bairro urbano".

Isso comunica ao usuário que está vendo uma área administrativa maior, não um bairro delimitado.

---

## Escopo da implementação

### Municípios afetados

- 821 municípios com distritos desproporcionais (fator >10×).
- Concentrados na Amazônia (AM, PA, AC, MT) mas presentes em todos os estados.

### Processo de reprocessamento (similar ao Strahler)

1. Baixar setores censitários por estado (shapefile IBGE 2022).
2. Cruzar geometria de cada distrito com setores censitários.
3. Calcular centroide ponderado pela população.
4. Atualizar `centroid_lat`/`centroid_lng` no banco para os 821 distritos.
5. Recalcular `hydro_proximity`, `terrain_slope` e weather para os novos centroides.
6. Salvar script em `scripts/python/`.

### Dependências

- Python com `geopandas`, `shapely`.
- Shapefiles do IBGE (baixar, processar, deletar — mesmo padrão do processamento do Strahler).
- Acesso ao banco para UPDATE em `neighborhoods`.

---

## Status

| Item | Status |
|---|---|
| Diagnóstico | ✅ Concluído |
| Decisão arquitetural | ✅ Aprovada |
| Documentação | ✅ Este arquivo |
| Implementação | ⏳ Roadmap |

---

## Referências

- Investigação realizada em agosto/2026.
- Dados verificados diretamente no banco de produção.
- 855 municípios identificados via query SQL.
- Fator de distorção calculado via bbox (jsonb, sem PostGIS).
- IBGE Censo 2022: `ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/`.
