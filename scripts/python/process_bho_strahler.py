"""
process_bho_strahler.py

Reprocessa hydro_proximity ponderando pela ordem de Strahler (nuordemcda) e
área de bacia contribuinte (nuareabacc) da BHO/ANA, em vez de tratar todo
curso d'água igual (unary_union do process_bho.py original -- ver
diagnóstico de 03/08/2026, docs/reports/diagnostico_mecanismos_impermeabilizacao.md,
que encontrou hydro_proximity saturado em ~1,0 pra 99% dos bairros).

Script novo, não substitui process_bho.py (preservado como referência).

IMPORTANTE -- direção real de nuordemcda (confirmado escaneando os 2.751.685
trechos nacionais, ver docs/architecture/ADR-008-strahler-hydro-proximity.md):
é o INVERSO da convenção clássica de Strahler. Ordem 1 = tronco principal
(maior porte -- mediana de 4,3km² de bacia, incluindo trechos com bacia de
até 5,9 milhões de km²); ordem 13 = cabeceira mínima (mediana de 0,048km²).
A documentação da ANA usa nomes diferentes (CDA_NU_ORDEM) pra essa mesma
coluna, mas não deixa essa direção óbvia -- só ficou claro comparando
nuareabacc por ordem. ORDEM_WEIGHTS abaixo já reflete a direção real, não a
direção que a nomenclatura "ordem de Strahler" sugeriria à primeira vista.

Uso:
    # Simulação (não escreve no banco, só compara e imprime)
    python scripts/python/process_bho_strahler.py --dry-run --states RN

    # Aplicar de verdade (só depois de aprovação explícita da simulação)
    python scripts/python/process_bho_strahler.py --states RN
    python scripts/python/process_bho_strahler.py  # todos os estados
"""

import argparse
import os
import re
from urllib.parse import urlparse

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

BHO_PATH = "dados-brutos/ana/geoft_bho_curso_dagua.gpkg"
BRASIL_BBOX = (-74.0, -33.8, -31.5, 5.5)
SEARCH_RADIUS_DEG = 0.2  # ~22km no equador -- mesmo raio da proposta original

# Pesos por nuordemcda -- direção corrigida (ver docstring acima): 1 = maior
# porte (tronco principal), valores crescentes = cabeceira progressivamente
# menor. Suavizado em vez de degraus abruptos, já que a maioria dos trechos
# nacionais (66%) cai entre ordem 4 e 6 -- ver distribuicao_strahler.csv.
# Sem validação de hidrólogo -- ver limitação no ADR-008.
ORDEM_WEIGHTS = {
    1: 1.00,
    2: 0.90,
    3: 0.75,
    4: 0.60,
    5: 0.45,
    6: 0.35,
    7: 0.25,
    8: 0.15,
    9: 0.10,
}
ORDEM_MIN_PESO = 0.08  # ordem >= 10 (cabeceira mínima, 0,46% dos trechos nacionais)
ORDEM_PESO_NEUTRO = 0.30  # nuordemcda nulo/ausente


def get_ordem_weight(ordem) -> float:
    if pd.isna(ordem):
        return ORDEM_PESO_NEUTRO
    ordem = int(ordem)
    if ordem in ORDEM_WEIGHTS:
        return ORDEM_WEIGHTS[ordem]
    if ordem >= 10:
        return ORDEM_MIN_PESO
    return ORDEM_PESO_NEUTRO


def load_hydro_with_strahler(bbox: tuple[float, float, float, float] = BRASIL_BBOX) -> gpd.GeoDataFrame:
    print("Carregando BHO (curso_dagua) com bbox nacional...")
    gdf = gpd.read_file(BHO_PATH, bbox=bbox, columns=["nuordemcda", "nuareabacc", "geometry"])
    print(f"Total de trechos carregados: {len(gdf)}")
    print(f"Distribuição de ordens:\n{gdf['nuordemcda'].value_counts().sort_index()}")
    return gdf


def normalize_proximity(distance_km: float) -> float:
    """Mesma curva do process_bho.py original (0.5km=perto, 5km=longe) --
    não é mais usada diretamente aqui (o novo score já combina peso+distância),
    mantida só de referência caso precise comparar com o método antigo."""
    if distance_km <= 0.5:
        return 1.0
    if distance_km >= 5.0:
        return 0.0
    return 1.0 - (distance_km - 0.5) / (5.0 - 0.5)


def compute_hydro_proximity_weighted(
    centroid: Point, hydro_gdf: gpd.GeoDataFrame, search_radius_deg: float = SEARCH_RADIUS_DEG
) -> float:
    """Em vez de unary_union tratando todo rio igual, calcula um score por
    trecho próximo = peso_da_ordem * (1 - distância_normalizada), e usa o
    maior score entre os trechos dentro do raio de busca. Um bairro perto de
    um rio grande pontua mais que um perto só de córrego pequeno, mesmo que
    o córrego esteja fisicamente mais perto."""
    minx, maxx = centroid.x - search_radius_deg, centroid.x + search_radius_deg
    miny, maxy = centroid.y - search_radius_deg, centroid.y + search_radius_deg

    nearby = hydro_gdf.cx[minx:maxx, miny:maxy]
    if len(nearby) == 0:
        return 0.0

    best = 0.0
    for _, river in nearby.iterrows():
        dist = centroid.distance(river.geometry)
        peso = get_ordem_weight(river["nuordemcda"])
        dist_normalized = min(dist / search_radius_deg, 1.0)
        score = peso * (1 - dist_normalized)
        if score > best:
            best = score
    return min(best, 1.0)


def get_db_connection():
    import pg8000.native as pg8000

    conn_str = os.environ["SUPABASE_CONNECTION_STRING"]
    parsed = urlparse(conn_str)
    return pg8000.Connection(
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port or 5432,
        database=parsed.path.lstrip("/"),
        ssl_context=True,
    )


def fetch_neighborhoods(conn, states: list[str] | None) -> pd.DataFrame:
    sql = """
        select n.id, n.name, n.centroid_lat, n.centroid_lng, c.state, n.hydro_proximity
        from neighborhoods n
        join cities c on c.id = n.city_id
        where c.active = true
          and n.centroid_lat is not null
          and n.centroid_lng is not null
    """
    params = {}
    if states:
        sql += " and c.state = any(:states)"
        params["states"] = states
    rows = conn.run(sql, **params)
    return pd.DataFrame(rows, columns=["id", "name", "centroid_lat", "centroid_lng", "state", "hydro_proximity_atual"])


CHECKPOINT_PATH = "dados-brutos/ana/strahler_checkpoint.csv"


def main():
    parser = argparse.ArgumentParser(description="Reprocessa hydro_proximity ponderado por ordem de Strahler (BHO/ANA)")
    parser.add_argument("--dry-run", action="store_true", help="Só simula e imprime comparação -- NÃO escreve no banco")
    parser.add_argument("--states", nargs="*", default=None, help="Filtrar por sigla de estado (ex: RN RS). Default: todos.")
    parser.add_argument(
        "--from-checkpoint",
        metavar="PATH",
        help=f"Pula o cálculo geoespacial (que pode levar horas) e aplica o UPDATE direto a partir "
        f"de um checkpoint salvo anteriormente (default salvo em {CHECKPOINT_PATH}). Uso: recuperar "
        f"de uma falha na fase de UPDATE sem recalcular tudo de novo.",
    )
    args = parser.parse_args()

    if args.from_checkpoint:
        neighborhoods = pd.read_csv(args.from_checkpoint)
        print(f"Checkpoint carregado de {args.from_checkpoint}: {len(neighborhoods)} bairros.")
    else:
        # Conexão só pra essa query -- reaberta antes do UPDATE (ver abaixo),
        # não reaproveitada depois do cálculo geoespacial (pode levar horas;
        # o pooler do Supabase em modo transaction derruba conexão ociosa
        # bem antes disso).
        conn = get_db_connection()
        neighborhoods = fetch_neighborhoods(conn, args.states)
        conn.close()
        print(f"Bairros carregados: {len(neighborhoods)}" + (f" (estados: {args.states})" if args.states else " (Brasil inteiro)"))

        hydro_gdf = load_hydro_with_strahler()

        novos = []
        for _, n in neighborhoods.iterrows():
            centroid = Point(n["centroid_lng"], n["centroid_lat"])
            novos.append(compute_hydro_proximity_weighted(centroid, hydro_gdf))
        neighborhoods["hydro_proximity_novo"] = novos
        neighborhoods["diferenca"] = neighborhoods["hydro_proximity_novo"] - neighborhoods["hydro_proximity_atual"]

        # Checkpoint em disco ANTES de tentar gravar no banco -- se o UPDATE
        # falhar (conexão morta, timeout, etc.), o cálculo geoespacial (a
        # parte lenta, pode levar horas) não precisa rodar de novo: basta
        # `--from-checkpoint` nesse arquivo.
        os.makedirs(os.path.dirname(CHECKPOINT_PATH), exist_ok=True)
        neighborhoods.to_csv(CHECKPOINT_PATH, index=False)
        print(f"\nCheckpoint salvo em {CHECKPOINT_PATH} ({len(neighborhoods)} bairros) -- "
              f"recuperável via --from-checkpoint se o UPDATE falhar.")

        print("\nComparação hydro_proximity -- atual vs ponderado por Strahler:")
        print(f"{'Bairro':<30} {'Estado':<6} {'Atual':>8} {'Novo':>8} {'Diferença':>10}")
        for _, n in neighborhoods.sort_values("diferenca").iterrows():
            print(f"{n['name'][:30]:<30} {n['state']:<6} {n['hydro_proximity_atual']:>8.3f} {n['hydro_proximity_novo']:>8.3f} {n['diferenca']:>+10.3f}")

        print(f"\nResumo -- atual: média={neighborhoods['hydro_proximity_atual'].mean():.3f}, desvio={neighborhoods['hydro_proximity_atual'].std():.3f}")
        print(f"Resumo -- novo:  média={neighborhoods['hydro_proximity_novo'].mean():.3f}, desvio={neighborhoods['hydro_proximity_novo'].std():.3f}")

    if args.dry_run:
        print("\n[--dry-run] Nenhuma escrita no banco foi feita.")
        return

    # Conexão nova aqui, não a de fetch_neighborhoods -- pode ter passado
    # muito tempo (cálculo geoespacial) desde que aquela foi aberta.
    print("\nAplicando UPDATE no banco...")
    conn = get_db_connection()
    updated = 0
    rows = neighborhoods.to_dict("records")
    for i, n in enumerate(rows):
        row_id = str(n["id"])
        if not UUID_RE.match(row_id):
            raise ValueError(f"id inesperado (não é UUID) na linha {i}: {row_id!r}")
        novo = float(n["hydro_proximity_novo"])
        # SQL montado direto (sem :param do pg8000) de propósito -- conn.run()
        # só usa o protocolo "simple query" (sem prepared statement) quando
        # não há kwargs; com :param, sempre usa o protocolo estendido com
        # unnamed prepared statement, que se mostrou incompatível com o
        # pooler do Supabase em modo transaction (erro real observado:
        # "unnamed prepared statement does not exist" seguido de "bind
        # message supplies 2 parameters, but prepared statement requires 13"
        # -- contagem de parâmetro mudando sozinha entre tentativas indica
        # cross-talk de prepared statement entre conexões do pool, não
        # timeout). Seguro aqui porque row_id já foi validado como UUID por
        # regex acima e novo é um float que nós mesmos calculamos -- nenhum
        # dos dois vem de input externo.
        sql = f"update neighborhoods set hydro_proximity = {novo!r} where id = '{row_id}'::uuid"
        for attempt in range(3):
            try:
                conn.run(sql)
                break
            except Exception as e:
                print(f"  [aviso] falha na linha {i} ({n['name']}/{n['state']}), tentativa {attempt + 1}/3: {e}")
                try:
                    conn.close()
                except Exception:
                    pass
                conn = get_db_connection()
        else:
            raise RuntimeError(f"Falhou 3 vezes seguidas em {n['name']}/{n['state']} (linha {i}) -- abortando.")
        updated += 1
        if updated % 1000 == 0:
            print(f"  {updated}/{len(rows)} bairros atualizados...")
    print(f"\n{updated} bairros atualizados.")


if __name__ == "__main__":
    main()
