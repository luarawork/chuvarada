# MERGE/CPTEC — operação

Este documento explica como rodar e manter `scripts/fetch_merge_cptec.py`, que
popula a tabela `merge_cache` com precipitação real (satélite GPM/IMERG-Late
fundido com pluviômetros do INMET pelo CPTEC). Motivação e arquitetura
completa em `scripts/proposta_integracao_merge_cptec.md`.

**Importante**: esse script roda **separado** do cron Node.js
(`app/api/cron/update`). GRIB2 (o formato dos arquivos do CPTEC) não tem
parser maduro em Node/TypeScript — o script usa `rasterio`/GDAL via o Python
do projeto. O cron só *lê* `merge_cache` (via `lib/merge.ts`); quem *escreve*
nela é sempre este script Python, rodado à parte.

## Como rodar manualmente

```bash
"C:\Users\Luara\tools\python-embed\python.exe" scripts/fetch_merge_cptec.py
```

(ou `python scripts/fetch_merge_cptec.py` se você tiver um Python do sistema
com as dependências abaixo instaladas)

Dependências: `rasterio`, `numpy`, `requests`, `pg8000` (driver Postgres
puro-Python — `psycopg2` não está disponível no Python embutido deste
projeto, e `pg8000` não precisa de compilador). Instalar com:

```bash
"C:\Users\Luara\tools\python-embed\python.exe" -m pip install rasterio numpy requests pg8000
```

O script lê `SUPABASE_CONNECTION_STRING` de `.env.local` automaticamente
(parser manual embutido no próprio script — não depende de `python-dotenv`).

## O que o script faz a cada execução

1. Busca os **3 arquivos `DAILY` mais recentes disponíveis** (tenta hoje, depois
   ontem, anteontem, etc. — o dia corrente pode ainda não estar publicado) e
   soma célula a célula pra obter `rain_72h`.
2. Busca as **3 horas `HOURLY_NOW` mais recentes disponíveis** (o CPTEC pode
   levar até ~1h pra publicar a hora corrente) e pega o máximo célula a célula
   pra obter `rain_peak_3h`.
3. Grava (upsert) 1 linha por célula de grade de 0,1° (~10km) dentro do bbox
   do Nordeste em `merge_cache` — ~31.500 células por execução.

## Frequência recomendada

- **1x por dia** é suficiente pro arquivo `DAILY` (ele só é publicado 1x/dia
  mesmo) — mas o script busca `HOURLY_NOW` toda vez que roda, então **vale
  rodar a cada hora**, não só 1x/dia, pra manter `rain_peak_3h` fresco.
- Recomendação prática: **1x por hora**, todo dia, o ano inteiro. O script já
  é barato (~31.500 células, 6 downloads de GRIB2 pequenos, ~1-2min de
  execução) — rodar de hora em hora não tem custo relevante.

### Exemplo de crontab (Linux/Mac, se o servidor de produção for esse tipo de ambiente)

```cron
0 * * * * cd /caminho/para/chuvarada && /usr/bin/python3 scripts/fetch_merge_cptec.py >> /var/log/chuvarada/merge_cptec.log 2>&1
```

### Exemplo de Agendador de Tarefas do Windows (ambiente de desenvolvimento local)

```powershell
$action = New-ScheduledTaskAction -Execute "C:\Users\Luara\tools\python-embed\python.exe" `
  -Argument "scripts/fetch_merge_cptec.py" `
  -WorkingDirectory "C:\Users\Luara\Downloads\chuvarada"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName "ChuvaradaMergeCPTEC" -Action $action -Trigger $trigger
```

## O que fazer se o CPTEC estiver fora do ar

Nada de manual — o sistema já foi desenhado pra isso:

- Se o script **não conseguir baixar nenhum arquivo `DAILY`** dos últimos 4
  dias, ele aborta sem gravar nada (`SystemExit`) — não sobrescreve dado bom
  com dado vazio. O `merge_cache` existente continua servindo até a próxima
  execução bem-sucedida.
- Se não conseguir nenhum arquivo `HOURLY_NOW`, ele grava `rain_72h` mesmo
  assim (só `rain_72h` depende do `DAILY`) e loga um aviso; `rain_peak_3h`
  fica em 0 nessa rodada específica.
- Do lado do cron Node.js (`lib/merge.ts`/`lib/weather.ts`): se o
  `merge_cache` mais recente pra uma célula tiver **mais de 6 horas**, o
  cron considera o dado velho demais e usa a Open-Meteo pra `rain_72h`/
  `rain_peak_3h` naquele ciclo (comportamento atual antes desta integração)
  — sem precisar de nenhuma ação manual. Isso significa: se este script parar
  de rodar por mais de 6h (CPTEC fora do ar, agendador quebrado, etc.), o app
  volta sozinho a funcionar só com Open-Meteo, sem erro visível pro usuário.
- `weather_cache.rain_source` registra qual fonte foi usada em cada leitura
  (`'merge_cptec'` ou `'openmeteo'`) — útil pra checar rapidamente se a
  integração está ativa: `select rain_source, count(*) from weather_cache
  where fetched_at > now() - interval '1 hour' group by rain_source;`

## Riscos conhecidos (ver proposta completa para mais detalhes)

- O CPTEC pode mudar a estrutura de pastas/nomes de arquivo sem aviso — é um
  diretório FTP/HTTPS de pesquisa acadêmica, sem contrato de API formal.
- A banda 2 do GRIB2 (documentada como "NEST", número de estações por célula)
  não bateu com o conteúdo real testado — o script usa só a banda 1 (`PREC`),
  que se comportou de forma consistente em todos os testes.
