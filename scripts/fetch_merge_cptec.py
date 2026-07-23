"""
fetch_merge_cptec.py

Busca o produto MERGE/CPTEC (precipitação diária/horária, satélite GPM/IMERG-Late
fundido com a rede de pluviômetros do INMET pelo CPTEC) e popula a tabela
merge_cache no Supabase. Roda separado do cron Node.js (ver
scripts/README_merge.md) porque GRIB2 não tem parser maduro em Node/TS — este
script usa rasterio/GDAL, já dependência do pipeline geoespacial.

Input: https://ftp.cptec.inpe.br/modelos/tempo/MERGE/GPM/ — diretório HTTPS
       público, sem autenticação (confirmado em scripts/proposta_integracao_merge_cptec.md).

       Estrutura REAL confirmada (o pedido original citava um padrão de nome
       "acum_1dia"/"acum_1hora" que não existe no servidor — os nomes reais são):
         DAILY/{ano}/{mes}/MERGE_CPTEC_{ano}{mes}{dia}.grib2
         HOURLY_NOW/{ano}/{mes}/{dia}/MERGE_CPTEC_{ano}{mes}{dia}{hora}.grib2
       (hora em UTC, 2 dígitos, 00-23)

Output: linhas em merge_cache (1 por célula de grade de 0.1° dentro do bbox
        do Brasil coberto pelo app -- Nordeste + Sul + Sudeste, ver
        BRASIL_BBOX --, por dia) — rain_72h (soma dos 3 arquivos DAILY mais
        recentes disponíveis) e rain_peak_3h (máximo dos 3 arquivos
        HOURLY_NOW mais recentes disponíveis).

Dependências: rasterio, numpy, pg8000 (driver Postgres puro-Python — psycopg2
não está disponível neste ambiente; pg8000 não precisa de compilador).

Uso: python scripts/fetch_merge_cptec.py
"""

import os
from datetime import date, datetime, timedelta, timezone

import numpy as np
import rasterio
import requests


def load_env_local() -> None:
    """Lê scripts/../.env.local manualmente (sem depender de python-dotenv,
    que não está instalado no Python embutido do projeto) — só preenche
    variáveis que ainda não estão no ambiente, pra não sobrescrever algo
    já exportado explicitamente na sessão."""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env.local")
    if not os.path.isfile(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


load_env_local()

BASE_URL = "https://ftp.cptec.inpe.br/modelos/tempo/MERGE/GPM"
HEADERS = {"User-Agent": "Mozilla/5.0 (Chuvarada MERGE fetcher)"}

# Bbox do Nordeste original (scripts/diagnostico_estados_lacunas.md) — mesma
# margem de segurança já validada pra cobrir os 9 estados sem cortar borda.
# Alargado em 21/07/2026 pra cobrir também Sul + Sudeste (expansão nacional):
# união do retângulo do Nordeste com o retângulo que cobre PR/SC/RS/SP/RJ/MG/ES
# (mesmos 7 bboxes usados em process_state_neighborhoods.py/OpenTopography)
# -- min/max dos 2 bboxes, não um recorte por estado.
#
# Alargado de novo em 22/07/2026 pra cobrir Centro-Oeste + Norte (expansão
# nacional completa, 27 estados): west estende até -73.8 (fronteira do
# Acre/Amazonas com o Peru) e north até 5.5 (Roraima/Amapá, únicos estados
# do país acima da linha do Equador). south/east não mudam -- RS e o litoral
# de João Pessoa já eram os extremos nessas direções.
BRASIL_BBOX = (-74.0, -33.8, -31.5, 5.5)  # min_lon, min_lat, max_lon, max_lat

DAILY_LOOKBACK_DAYS = 4  # busca hoje + até 3 dias atrás, precisa de 3 válidos pra somar 72h
HOURLY_LOOKBACK_HOURS = 12  # busca até 12h atrás, precisa de 3 válidas pra o pico de 3h


def fetch_grib2(url: str) -> bytes | None:
    try:
        res = requests.get(url, headers=HEADERS, timeout=30)
        if res.status_code != 200 or not res.content:
            return None
        return res.content
    except requests.RequestException as e:
        print(f"[aviso] falha ao buscar {url}: {e}")
        return None


# Origem e passo da grade nativa do MERGE, confirmados no .ctl que acompanha
# cada arquivo (xdef 1001 linear -120.05 0.1 / ydef 924 linear -60.05 0.1).
# Gerar a grade de coordenadas a partir daqui (em vez de derivar da janela
# recortada de cada arquivo) evita depender de arredondamento de janela
# (rasterio round_offsets/round_lengths) bater exatamente igual entre os
# produtos DAILY e HOURLY_NOW — na prática eles vieram com 1 pixel de
# diferença de alinhamento entre si, o que quebrava a soma célula-a-célula.
GRID_STEP = 0.1
GRID_ORIGIN_LON = -120.05
GRID_ORIGIN_LAT = -60.05


def canonical_grid(bbox: tuple[float, float, float, float]):
    """Gera a lista de coordenadas de célula (centro de pixel) da grade
    nativa do MERGE que caem dentro do bbox pedido."""
    min_lon, min_lat, max_lon, max_lat = bbox
    lngs = []
    lng = GRID_ORIGIN_LON
    while lng <= max_lon + GRID_STEP:
        if lng >= min_lon - GRID_STEP:
            lngs.append(round(lng, 4))
        lng += GRID_STEP
    lats = []
    lat = GRID_ORIGIN_LAT
    while lat <= max_lat + GRID_STEP:
        if lat >= min_lat - GRID_STEP:
            lats.append(round(lat, 4))
        lat += GRID_STEP
    lngs = [v for v in lngs if min_lon <= v <= max_lon]
    lats = [v for v in lats if min_lat <= v <= max_lat]
    return lats, lngs


def sample_grid(grib_bytes: bytes, lats: list[float], lngs: list[float]) -> np.ndarray:
    """Abre o GRIB2 em memória e extrai o valor de precipitação (banda 1)
    em cada ponto (lat,lng) da grade canônica, por lookup direto de
    pixel (não por recorte de janela) — imune a qualquer diferença de
    alinhamento entre arquivos/produtos."""
    with rasterio.MemoryFile(grib_bytes) as memfile:
        with memfile.open() as src:
            band = src.read(1)
            out = np.zeros((len(lats), len(lngs)), dtype="float64")
            for r, lat in enumerate(lats):
                for c, lng in enumerate(lngs):
                    row, col = src.index(lng, lat)
                    if 0 <= row < band.shape[0] and 0 <= col < band.shape[1]:
                        val = float(band[row, col])
                        out[r, c] = 0.0 if abs(val) > 1e6 else val
            return out


def daily_url(d: date) -> str:
    return f"{BASE_URL}/DAILY/{d.year:04d}/{d.month:02d}/MERGE_CPTEC_{d.year:04d}{d.month:02d}{d.day:02d}.grib2"


def hourly_url(dt: datetime) -> str:
    return (
        f"{BASE_URL}/HOURLY_NOW/{dt.year:04d}/{dt.month:02d}/{dt.day:02d}/"
        f"MERGE_CPTEC_{dt.year:04d}{dt.month:02d}{dt.day:02d}{dt.hour:02d}.grib2"
    )


def collect_daily_grids(bbox, max_files: int = 3):
    """Percorre hoje -> hoje-(DAILY_LOOKBACK_DAYS-1) e retorna os `max_files`
    arquivos DAILY mais recentes que existirem de fato (o dia corrente pode
    ainda não estar publicado)."""
    today = datetime.now(timezone.utc).date()
    found = []
    for i in range(DAILY_LOOKBACK_DAYS):
        d = today - timedelta(days=i)
        url = daily_url(d)
        content = fetch_grib2(url)
        if content is None:
            print(f"[DAILY] {d.isoformat()}: indisponível ({url})")
            continue
        print(f"[DAILY] {d.isoformat()}: OK ({len(content)} bytes)")
        found.append((d, content))
        if len(found) >= max_files:
            break
    return found


def collect_hourly_grids(bbox, max_files: int = 3):
    """Percorre a hora atual (UTC) pra trás até HOURLY_LOOKBACK_HOURS e
    retorna os `max_files` arquivos HOURLY_NOW mais recentes disponíveis —
    o CPTEC pode levar até ~1h pra publicar a hora corrente."""
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    found = []
    for i in range(HOURLY_LOOKBACK_HOURS):
        dt = now - timedelta(hours=i)
        url = hourly_url(dt)
        content = fetch_grib2(url)
        if content is None:
            print(f"[HOURLY_NOW] {dt.isoformat()}: indisponível ({url})")
            continue
        print(f"[HOURLY_NOW] {dt.isoformat()}: OK ({len(content)} bytes)")
        found.append((dt, content))
        if len(found) >= max_files:
            break
    return found


def build_cache_rows(bbox):
    daily_files = collect_daily_grids(bbox, max_files=3)
    hourly_files = collect_hourly_grids(bbox, max_files=3)

    if not daily_files:
        raise SystemExit("Nenhum arquivo DAILY disponível nos últimos dias — abortando sem gravar nada.")

    lats, lngs = canonical_grid(bbox)

    # rain_72h: soma dos DAILY encontrados (até 3) sobre a mesma grade
    daily_sum = np.zeros((len(lats), len(lngs)))
    for _, content in daily_files:
        daily_sum += sample_grid(content, lats, lngs)

    # rain_peak_3h: máximo por célula entre os HOURLY_NOW encontrados (até 3)
    if hourly_files:
        hourly_peak = np.zeros((len(lats), len(lngs)))
        for _, content in hourly_files:
            hourly_peak = np.maximum(hourly_peak, sample_grid(content, lats, lngs))
    else:
        print("[aviso] nenhum arquivo HOURLY_NOW disponível — rain_peak_3h ficará 0 para todas as células.")
        hourly_peak = np.zeros_like(daily_sum)

    reference_date = daily_files[0][0]
    reference_hour = hourly_files[0][0].hour if hourly_files else None

    rows = []
    for r, lat in enumerate(lats):
        for c, lng in enumerate(lngs):
            rows.append(
                {
                    "lat": float(lat),
                    "lng": float(lng),
                    "grid_lat": float(lat),
                    "grid_lng": float(lng),
                    "rain_72h": round(float(daily_sum[r, c]), 3),
                    "rain_peak_3h": round(float(hourly_peak[r, c]), 3),
                    "data_date": reference_date.isoformat(),
                    "data_hour": reference_hour,
                }
            )
    return rows, [d.isoformat() for d, _ in daily_files], [dt.isoformat() for dt, _ in hourly_files]


def save_rows(rows: list[dict]) -> int:
    import pg8000.native as pg8000

    conn_str = os.environ["SUPABASE_CONNECTION_STRING"]
    # pg8000 não aceita a URL postgresql:// diretamente — parse manual dos componentes.
    from urllib.parse import urlparse

    parsed = urlparse(conn_str)
    conn = pg8000.Connection(
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port or 5432,
        database=parsed.path.lstrip("/"),
        ssl_context=True,
    )

    inserted = 0
    try:
        # Lock de escrita -- sinaliza pro cron Node.js (lib/merge.ts) que
        # merge_cache está sendo gravado agora, pra ele não ler uma célula
        # já atualizada e outra ainda não nessa mesma rodada (ver
        # scripts/sql/018_system_locks.sql e o incidente de Natal,
        # 21/07/2026, que motivou isso). Liberado no finally mesmo se a
        # gravação falhar no meio.
        conn.run(
            "insert into system_locks (key, locked_at, locked_by) values ('merge_cache_write', now(), 'fetch_merge_cptec') "
            "on conflict (key) do update set locked_at = excluded.locked_at, locked_by = excluded.locked_by"
        )

        # Insert em lote (1 round-trip de rede por lote, não 1 por célula) —
        # com dezenas de milhares de células no bbox (Nordeste + Sul + Sudeste),
        # inserir linha a linha
        # levaria dezenas de minutos só em latência de rede até o Supabase.
        batch_size = 500
        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]
            values_clauses = []
            params = {}
            for j, row in enumerate(batch):
                values_clauses.append(
                    f"(:lat{j}, :lng{j}, :grid_lat{j}, :grid_lng{j}, :rain_72h{j}, "
                    f":rain_peak_3h{j}, :data_date{j}, :data_hour{j}, 'merge_cptec', now())"
                )
                params[f"lat{j}"] = row["lat"]
                params[f"lng{j}"] = row["lng"]
                params[f"grid_lat{j}"] = row["grid_lat"]
                params[f"grid_lng{j}"] = row["grid_lng"]
                params[f"rain_72h{j}"] = row["rain_72h"]
                params[f"rain_peak_3h{j}"] = row["rain_peak_3h"]
                params[f"data_date{j}"] = row["data_date"]
                params[f"data_hour{j}"] = row["data_hour"]

            sql = (
                "insert into merge_cache (lat, lng, grid_lat, grid_lng, rain_72h, rain_peak_3h, data_date, data_hour, source, fetched_at) "
                "values " + ",".join(values_clauses) + " "
                "on conflict (grid_lat, grid_lng, data_date) "
                "do update set rain_72h = excluded.rain_72h, "
                "rain_peak_3h = excluded.rain_peak_3h, "
                "data_hour = excluded.data_hour, "
                "fetched_at = excluded.fetched_at"
            )
            conn.run(sql, **params)
            inserted += len(batch)
            print(f"  gravadas {min(i + batch_size, len(rows))}/{len(rows)} células...")
        # pg8000.native.Connection já faz autocommit por statement (sem
        # transação explícita) — não existe/precisa de conn.commit() aqui.
    finally:
        conn.run("delete from system_locks where key = 'merge_cache_write'")
        conn.close()
    return inserted


def main():
    rows, daily_dates, hourly_times = build_cache_rows(BRASIL_BBOX)
    print(f"\n{len(rows)} células dentro do bbox ({BRASIL_BBOX}).")
    print(f"Arquivos DAILY usados (rain_72h, soma de até 3): {daily_dates}")
    print(f"Arquivos HOURLY_NOW usados (rain_peak_3h, máximo de até 3): {hourly_times}")

    inserted = save_rows(rows)
    print(f"\n{inserted} células gravadas/atualizadas em merge_cache.")


if __name__ == "__main__":
    main()
