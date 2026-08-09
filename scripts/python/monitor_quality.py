#!/usr/bin/env python3
"""Monitor de qualidade de dados do Chuvarada.
Roda semanalmente, rotacionando por região.
Abre issue no GitHub se encontrar problemas."""

import os
import pathlib
import psycopg2
import requests
from datetime import datetime, timezone

# Rotação por região baseada na semana do ano
REGIOES = [
    ('Norte',        ['AM', 'PA', 'AP', 'RO', 'AC', 'RR', 'TO']),
    ('Nordeste',     ['MA', 'PI', 'CE', 'RN', 'PB', 'PE', 'AL', 'SE', 'BA']),
    ('Centro-Oeste', ['MT', 'MS', 'GO', 'DF']),
    ('Sudeste',      ['SP', 'RJ', 'MG', 'ES']),
    ('Sul',          ['PR', 'SC', 'RS']),
]

week_number = datetime.now(timezone.utc).isocalendar()[1]
regiao_nome, estados = REGIOES[week_number % len(REGIOES)]

# Exporta pro GITHUB_ENV pra o step de commit do workflow poder usar
# ${{ env.REGIAO }} na mensagem -- sem isso a variável nunca é setada
# (guardado por "GITHUB_ENV" in os.environ pra não quebrar rodada local).
if "GITHUB_ENV" in os.environ:
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as f:
        f.write(f"REGIAO={regiao_nome}\n")

print(f"[monitor-quality] Região: {regiao_nome} ({', '.join(estados)})")
print(f"Semana {week_number} — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}")

conn = psycopg2.connect(os.environ['SUPABASE_CONNECTION_STRING'])
cur = conn.cursor()

issues = []
warnings = []

estados_placeholder = ','.join(['%s'] * len(estados))

# ─── 1. BAIRROS COM HYDRO_PROXIMITY = 0 ─────────────────────────

cur.execute(f"""
    SELECT n.name, c.name, c.state,
           n.centroid_lat, n.centroid_lng
    FROM neighborhoods n
    JOIN cities c ON c.id = n.city_id
    WHERE c.state IN ({estados_placeholder})
    AND n.hydro_proximity = 0
    AND c.active = true
""", estados)
zeros_hidro = cur.fetchall()
if zeros_hidro:
    lista = '\n'.join(
        f"  - {b} ({c}/{s}) lat={lat:.4f} lng={lng:.4f}"
        for b, c, s, lat, lng in zeros_hidro
    )
    warnings.append(
        f"🟡 {len(zeros_hidro)} bairros com hydro_proximity = 0 "
        f"na região {regiao_nome}:\n{lista}"
    )

# ─── 2. TERRAIN_SLOPE PLACEHOLDER (0.5) ─────────────────────────

cur.execute(f"""
    SELECT c.state, COUNT(*) as total
    FROM neighborhoods n
    JOIN cities c ON c.id = n.city_id
    WHERE c.state IN ({estados_placeholder})
    AND n.terrain_slope = 0.5
    AND c.active = true
    GROUP BY c.state
    ORDER BY total DESC
""", estados)
placeholders = cur.fetchall()
if placeholders:
    total_ph = sum(t for _, t in placeholders)
    por_estado = ', '.join(f"{s}: {t}" for s, t in placeholders)
    warnings.append(
        f"🟡 {total_ph} bairros com terrain_slope placeholder (0.5) "
        f"na região {regiao_nome}: {por_estado}"
    )

# ─── 3. CENTROIDES SUSPEITOS ─────────────────────────────────────

# Bbox aproximado por estado (lat_min, lat_max, lng_min, lng_max)
BBOX_BRASIL = (-33.8, 5.5, -74.0, -31.5)

cur.execute(f"""
    SELECT n.name, c.name, c.state,
           n.centroid_lat, n.centroid_lng
    FROM neighborhoods n
    JOIN cities c ON c.id = n.city_id
    WHERE c.state IN ({estados_placeholder})
    AND c.active = true
    AND (
        n.centroid_lat < {BBOX_BRASIL[0]}
        OR n.centroid_lat > {BBOX_BRASIL[1]}
        OR n.centroid_lng < {BBOX_BRASIL[2]}
        OR n.centroid_lng > {BBOX_BRASIL[3]}
    )
""", estados)
bad_centroids = cur.fetchall()
if bad_centroids:
    lista = '\n'.join(
        f"  - {b} ({c}/{s}) lat={lat:.4f} lng={lng:.4f}"
        for b, c, s, lat, lng in bad_centroids
    )
    issues.append(
        f"🔴 {len(bad_centroids)} bairros com centroide fora do Brasil "
        f"na região {regiao_nome}:\n{lista}"
    )

# ─── 4. SCORE VS LEVEL INCONSISTENTES ───────────────────────────

cur.execute(f"""
    SELECT COUNT(*) FROM (
        SELECT DISTINCT ON (rs.neighborhood_id) rs.*
        FROM risk_scores rs
        JOIN neighborhoods n ON n.id = rs.neighborhood_id
        JOIN cities c ON c.id = n.city_id
        WHERE c.state IN ({estados_placeholder})
        ORDER BY rs.neighborhood_id, rs.calculated_at DESC
    ) rs
    WHERE (rs.level = 'critical' AND rs.score < 8.0
           AND rs.auto_critical = false)
    OR (rs.level = 'high'
        AND (rs.score < 6.5 OR rs.score >= 8.0))
    OR (rs.level = 'moderate'
        AND (rs.score < 5.0 OR rs.score >= 6.5))
    OR (rs.level = 'attention'
        AND (rs.score < 3.0 OR rs.score >= 5.0))
    OR (rs.level = 'normal' AND rs.score >= 3.0
        AND rs.auto_critical = false)
""", estados)
inconsistent = cur.fetchone()[0]
if inconsistent > 0:
    issues.append(
        f"🔴 {inconsistent} bairros com score/level inconsistentes "
        f"na região {regiao_nome}"
    )

# ─── 5. DISTRIBUIÇÃO DE SCORES SUSPEITA ─────────────────────────

cur.execute(f"""
    SELECT
        rs.level,
        COUNT(*) as total,
        COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as pct
    FROM (
        SELECT DISTINCT ON (rs.neighborhood_id) rs.*
        FROM risk_scores rs
        JOIN neighborhoods n ON n.id = rs.neighborhood_id
        JOIN cities c ON c.id = n.city_id
        WHERE c.state IN ({estados_placeholder})
        ORDER BY rs.neighborhood_id, rs.calculated_at DESC
    ) rs
    GROUP BY rs.level
""", estados)
dist = {row[0]: (row[1], float(row[2])) for row in cur.fetchall()}

pct_critical = dist.get('critical', (0, 0))[1]
if pct_critical > 30:
    issues.append(
        f"🔴 {pct_critical:.1f}% dos bairros da região {regiao_nome} "
        f"estão em crítico — possível falso positivo em massa ou evento extremo real"
    )
elif pct_critical > 15:
    warnings.append(
        f"🟡 {pct_critical:.1f}% dos bairros da região {regiao_nome} "
        f"estão em crítico — monitorar"
    )

# ─── 6. HYDRO_PROXIMITY SATURADO ────────────────────────────────

cur.execute(f"""
    SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN n.hydro_proximity >= 0.999 THEN 1 END) as saturados,
        COUNT(CASE WHEN n.hydro_proximity >= 0.999 THEN 1 END) * 100.0
            / COUNT(*) as pct_saturados
    FROM neighborhoods n
    JOIN cities c ON c.id = n.city_id
    WHERE c.state IN ({estados_placeholder})
    AND c.active = true
""", estados)
row = cur.fetchone()
pct_sat = float(row[2]) if row[2] else 0
if pct_sat > 5:
    warnings.append(
        f"🟡 {pct_sat:.1f}% dos bairros da região {regiao_nome} "
        f"com hydro_proximity saturado (≥0.999) — verificar reprocessamento Strahler"
    )

# ─── SALVAR RELATÓRIO ────────────────────────────────────────────

conn.close()

# Salvar em docs/reports/qualidade/
pasta = pathlib.Path("docs/reports/qualidade")
pasta.mkdir(parents=True, exist_ok=True)
arquivo = pasta / f"{datetime.now(timezone.utc).strftime('%Y-%m-%d')}-{regiao_nome.lower().replace('-', '')}.md"

with open(arquivo, 'w', encoding='utf-8') as f:
    f.write(f"# Quality Report — {regiao_nome}\n")
    f.write(f"**Data:** {datetime.now(timezone.utc).strftime('%Y-%m-%d')}\n")
    f.write(f"**Estados:** {', '.join(estados)}\n\n")
    if issues:
        f.write("## 🔴 Problemas críticos\n\n")
        for issue in issues:
            f.write(f"- {issue}\n")
        f.write("\n")
    if warnings:
        f.write("## 🟡 Avisos\n\n")
        for warning in warnings:
            f.write(f"- {warning}\n")
        f.write("\n")
    if not issues and not warnings:
        f.write("## ✅ Nenhum problema encontrado\n")

print(f"Relatório salvo em {arquivo}")

# Abrir issue se houver problemas críticos
if issues:
    title = f"[Quality Monitor] {regiao_nome} — {len(issues)} problema(s) — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    body = f"## Quality Report — {regiao_nome}\n\n"
    body += "## 🔴 Problemas críticos\n\n"
    body += "\n".join(f"- {issue}" for issue in issues)
    if warnings:
        body += "\n\n## 🟡 Avisos\n\n"
        body += "\n".join(f"- {warning}" for warning in warnings)
    body += f"\n\n---\n*Relatório completo: `{arquivo}`*"

    response = requests.post(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/issues",
        headers={
            "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
            "Accept": "application/vnd.github+json",
        },
        json={
            "title": title,
            "body": body,
            "labels": ["quality-monitor"],
        }
    )

    if response.status_code == 201:
        print(f"Issue aberta: {response.json()['html_url']}")
    else:
        print(f"Erro ao abrir issue: {response.status_code}")
        exit(1)

    exit(1)

print("✅ Qualidade OK")
