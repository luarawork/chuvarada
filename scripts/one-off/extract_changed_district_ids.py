import pandas as pd
import math

CSV_PATH = 'dados-brutos/district_centroids_new.csv'
OUTPUT   = 'dados-brutos/district_ids_to_reprocess.txt'

GRID_RESOLUTION = 0.1

def grid_cell(lat, lng):
    # Precisa bater EXATAMENTE com gridCell() em lib/grid.ts (Math.round,
    # não Math.floor -- floor classifica errado distritos perto de borda
    # de célula, dando 4.401 em vez dos 4.522 reais).
    return (
        round(round(lat / GRID_RESOLUTION) * GRID_RESOLUTION, 6),
        round(round(lng / GRID_RESOLUTION) * GRID_RESOLUTION, 6),
    )

df = pd.read_csv(CSV_PATH)
df = df[df['method'] != 'NO_MATCH'].copy()
df['new_lat'] = pd.to_numeric(df['new_lat'], errors='coerce')
df['new_lng'] = pd.to_numeric(df['new_lng'], errors='coerce')
df = df.dropna(subset=['new_lat', 'new_lng'])

df['cell_old'] = df.apply(
    lambda r: grid_cell(r['current_lat'], r['current_lng']), axis=1)
df['cell_new'] = df.apply(
    lambda r: grid_cell(r['new_lat'], r['new_lng']), axis=1)

changed = df[df['cell_old'] != df['cell_new']]
print(f"Distritos que mudaram de célula: {len(changed)}")

with open(OUTPUT, 'w') as f:
    for nid in changed['neighborhood_id']:
        f.write(str(nid) + '\n')

print(f"IDs salvos em {OUTPUT}")
