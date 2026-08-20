#!/usr/bin/env python3
"""Monitor de saúde operacional do Chuvarada.
Roda diariamente via GitHub Actions.
Abre issue no GitHub se encontrar problemas."""

import os
import psycopg2
import requests
from datetime import datetime, timezone

conn = psycopg2.connect(os.environ['SUPABASE_CONNECTION_STRING'])
cur = conn.cursor()

issues = []  # lista de problemas encontrados
warnings = []  # avisos não críticos

# ─── 1. BANCO DE DADOS ───────────────────────────────────────────

# 1.1 Tamanho do banco
cur.execute("SELECT pg_database_size(current_database()) / 1024.0 / 1024.0")
size_mb = cur.fetchone()[0]
LIMIT_MB = 500
ALERT_MB = 480

if size_mb > LIMIT_MB:
    issues.append(f"🔴 Banco em {size_mb:.1f}MB — {size_mb/LIMIT_MB*100:.0f}% do limite ({LIMIT_MB}MB)")
elif size_mb > ALERT_MB:
    warnings.append(f"🟡 Banco em {size_mb:.1f}MB — próximo do limite ({LIMIT_MB}MB)")

# 1.2 risk_scores com linhas > 24h (archive não drenando) -- corte reduzido
# de 48h pra 24h em 10/08/2026 junto com ARCHIVE_CUTOFF_HOURS
# (scripts/archive_to_b2.ts) e app/api/history/route.ts.
# archived_at IS NULL (migração 045, 19/08/2026): linha já marcada como
# arquivada já tem backup garantido no B2, só falta o DELETE (que roda logo
# em seguida no mesmo archive, ver deleteArchivedRiskScores) -- contar essas
# como "backlog não drenado" gerava falso positivo.
cur.execute("""
    SELECT COUNT(*), MIN(calculated_at)
    FROM risk_scores
    WHERE calculated_at < NOW() - INTERVAL '24 hours'
    AND archived_at IS NULL
""")
old_scores, oldest = cur.fetchone()
if old_scores and old_scores > 10000:
    issues.append(
        f"🔴 {old_scores:,} linhas de risk_scores com >24h no banco "
        f"(mais antiga: {oldest}). Archive não está drenando."
    )
elif old_scores and old_scores > 0:
    warnings.append(f"🟡 {old_scores:,} linhas de risk_scores com >24h (backlog pequeno)")

# 1.3 Duplicatas em risk_scores (últimas 24h)
cur.execute("""
    SELECT COUNT(*) FROM (
        SELECT neighborhood_id, DATE_TRUNC('hour', calculated_at)
        FROM risk_scores
        WHERE calculated_at > NOW() - INTERVAL '24 hours'
        GROUP BY neighborhood_id, DATE_TRUNC('hour', calculated_at)
        HAVING COUNT(*) > 1
    ) sub
""")
duplicates = cur.fetchone()[0]
if duplicates > 0:
    issues.append(
        f"🔴 {duplicates:,} bairros com scores duplicados nas últimas 24h. "
        f"Possível falha no lock do Cron A."
    )

# 1.4 Bloat de tabelas -- achado em 10/08/2026: municipalities acumulou
# 163MB (só 5MB de dado real) por bloat de TOAST nunca recuperado por
# autovacuum. n_dead_tup/n_live_tup de pg_stat_user_tables é a mesma
# métrica usada no diagnóstico manual que achou isso -- checar aqui evita
# precisar descobrir de novo via investigação manual da próxima vez.
cur.execute("""
    SELECT
        relname,
        n_dead_tup,
        n_live_tup,
        ROUND(n_dead_tup * 100.0 / NULLIF(n_live_tup, 0), 1)
            as pct_bloat,
        last_autovacuum
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 10000
    ORDER BY n_dead_tup DESC
    LIMIT 5
""")
bloat_tables = cur.fetchall()
for table, dead, live, pct, last_vac in bloat_tables:
    if pct and pct > 50:
        issues.append(
            f"🔴 Tabela `{table}` com {pct}% de bloat "
            f"({dead:,} linhas mortas). "
            f"Último vacuum: {last_vac or 'nunca'}. "
            f"Considerar VACUUM FULL."
        )
    elif pct and pct > 20:
        warnings.append(
            f"🟡 Tabela `{table}` com {pct}% de bloat "
            f"({dead:,} linhas mortas)."
        )

# ─── 2. SCORES EM TEMPO REAL ─────────────────────────────────────

# 2.1 Cidades com score > 2h sem atualizar -- via city_risk_summary
# (mantida pelo próprio cron a cada ciclo) em vez de NOT EXISTS direto em
# neighborhoods/risk_scores: testado localmente e a versão original dava
# "canceling statement due to statement timeout" no pooler do Supabase --
# o NOT EXISTS correlacionado pra cada uma das 5.570 cidades ativas,
# juntando neighborhoods+risk_scores por linha, é caro demais em escala
# nacional. city_risk_summary já tem 1 linha por cidade com last_updated,
# reduzindo a checagem a uma tabela pequena.
cur.execute("""
    SELECT COUNT(*)
    FROM cities c
    WHERE c.active = true
    AND NOT EXISTS (
        SELECT 1 FROM city_risk_summary crs
        WHERE crs.city_id = c.id
        AND crs.last_updated > NOW() - INTERVAL '2 hours'
    )
""")
stale_cities = cur.fetchone()[0]
if stale_cities > 100:
    issues.append(
        f"🔴 {stale_cities} cidades com score desatualizado (>2h). "
        f"Possível falha no Cron A."
    )
elif stale_cities > 0:
    warnings.append(f"🟡 {stale_cities} cidades com score desatualizado (>2h)")

# 2.2 Score vs level inconsistentes -- LATERAL em vez de DISTINCT ON global.
# Testado localmente: DISTINCT ON (neighborhood_id) * FROM risk_scores
# (sem filtro, ~1M+ linhas em escala nacional) passou de 60s sem terminar.
# LATERAL usa o índice risk_scores_neighborhood_time (neighborhood_id,
# calculated_at DESC) por bairro -- mesmo padrão já usado no endpoint de
# viewport (ver RELATORIO_COMPLETO.md, ~28x mais rápido que DISTINCT ON/
# view). Testado: ~3.6s pros 28.483 bairros, contra timeout antes.
cur.execute("""
    SELECT COUNT(*)
    FROM neighborhoods n
    JOIN LATERAL (
        SELECT score, level, auto_critical
        FROM risk_scores rs
        WHERE rs.neighborhood_id = n.id
        ORDER BY rs.calculated_at DESC
        LIMIT 1
    ) rs ON true
    WHERE (rs.level = 'critical' AND rs.score < 8.0 AND rs.auto_critical = false)
    OR (rs.level = 'high' AND (rs.score < 6.5 OR rs.score >= 8.0))
    OR (rs.level = 'moderate' AND (rs.score < 5.0 OR rs.score >= 6.5))
    OR (rs.level = 'attention' AND (rs.score < 3.0 OR rs.score >= 5.0))
    OR (rs.level = 'normal' AND rs.score >= 3.0 AND rs.auto_critical = false)
""")
inconsistent = cur.fetchone()[0]
if inconsistent > 10:
    issues.append(
        f"🔴 {inconsistent} bairros com score/level inconsistentes. "
        f"Possível bug no cálculo."
    )

# ─── 3. MERGE CACHE ──────────────────────────────────────────────

# 3.1 Células do MERGE estagnadas > 24h -- limiar recalibrado em 09/08/2026
# (investigação "MERGE estagnado Sul/Sudeste"): fetch_merge_cptec.py só
# atualiza fetched_at/last_changed_at quando o valor de chuva REALMENTE
# muda (otimização anti-bloat, ver save_rows() no próprio script) -- como
# o MERGE DAILY publica 1x/dia, é esperado que uma fração grande das
# células fique "estagnada" por design em época seca, não por falha.
# Medido no dia da investigação: ~26.220 células estagnadas nacionalmente
# em condição normal (baseline nacional 9,9%, Sul/Sudeste em estação seca
# chegando a 25,9% da região). O limiar antigo (10.000) disparava alerta
# todo dia mesmo sem problema nenhum -- 80k/50k dão folga real acima do
# baseline observado (>3x/>2x) antes de soar o alarme.
cur.execute("""
    SELECT COUNT(*)
    FROM merge_cache
    WHERE last_changed_at < NOW() - INTERVAL '24 hours'
    AND fetched_at > NOW() - INTERVAL '48 hours'
""")
stale_merge = cur.fetchone()[0]
if stale_merge > 80000:  # >3x o normal -- problema real
    issues.append(
        f"🔴 {stale_merge:,} células MERGE estagnadas >24h (normal em estação seca: ~26k). "
        f"Acima de 50k pode indicar falha no CPTEC."
    )
elif stale_merge > 50000:  # >2x o normal -- avisar
    warnings.append(
        f"🟡 {stale_merge:,} células MERGE estagnadas >24h (normal em estação seca: ~26k). "
        f"Acima de 50k pode indicar falha no CPTEC."
    )

# 3.2 merge_cache com linhas > 4 dias (retenção violada)
cur.execute("""
    SELECT COUNT(*)
    FROM merge_cache
    WHERE fetched_at < NOW() - INTERVAL '4 days'
    AND is_near_neighborhood = true
""")
old_merge = cur.fetchone()[0]
if old_merge > 0:
    issues.append(
        f"🔴 {old_merge:,} linhas de merge_cache próximo com >4 dias. "
        f"Retenção violada."
    )

# ─── 4. WEATHER CACHE ────────────────────────────────────────────

# COUNT(*) em vez de COUNT(DISTINCT city_id) -- cities não tem coluna
# city_id (é a própria PK "id"), achado rodando localmente.
cur.execute("""
    SELECT COUNT(*)
    FROM cities
    WHERE active = true
    AND id NOT IN (
        SELECT city_id FROM weather_cache
        WHERE fetched_at > NOW() - INTERVAL '32 hours'
    )
""")
stale_weather = cur.fetchone()[0]
if stale_weather > 500:
    issues.append(
        f"🔴 {stale_weather} cidades sem weather_cache atualizado (>32h). "
        f"Cron B pode estar falhando."
    )
elif stale_weather > 100:
    warnings.append(f"🟡 {stale_weather} cidades sem weather_cache atualizado (>32h)")

# ─── 5. TIDECHECK ────────────────────────────────────────────────

# tidecheck_cache não tem coluna valid_until -- a validade da série
# cacheada é series_ends_at (ver migração 038_tidecheck_cache.sql).
cur.execute("""
    SELECT COUNT(*)
    FROM cities c
    WHERE c.tide_station_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM tidecheck_cache tc
        WHERE tc.city_id = c.id
        AND tc.series_ends_at > NOW()
    )
""")
stale_tide = cur.fetchone()[0]
if stale_tide > 20:
    issues.append(
        f"🔴 {stale_tide} cidades costeiras sem dado de maré válido. "
        f"Possível falha no TideCheck ou cota esgotada."
    )
elif stale_tide > 5:
    warnings.append(f"🟡 {stale_tide} cidades costeiras sem dado de maré válido")

# ─── 6. B2 CACHE DE NEIGHBORHOODS ───────────────────────────────

# Verificar idade do cache de neighborhoods no B2
# (deve ser regenerado 1x/dia às 03h UTC)
cur.execute("SELECT NOW() AT TIME ZONE 'UTC'")
now_utc = cur.fetchone()[0]
# Se são mais de 25h desde as 03h UTC de hoje, o cache pode estar velho
# (verificação aproximada via timestamp no próprio arquivo — não acessível via SQL)
# Deixar como warning manual por ora

# ─── 7. RELATOS EXPIRADOS ────────────────────────────────────────

cur.execute("""
    SELECT COUNT(*)
    FROM user_reports
    WHERE status = 'active'
    AND expires_at < NOW()
""")
expired_reports = cur.fetchone()[0]
if expired_reports > 50:
    issues.append(
        f"🔴 {expired_reports} relatos expirados ainda com status 'active'. "
        f"Limpeza do cron não está funcionando."
    )
elif expired_reports > 0:
    warnings.append(f"🟡 {expired_reports} relatos expirados com status 'active'")

# ─── RELATÓRIO ───────────────────────────────────────────────────

conn.close()

total_issues = len(issues)
total_warnings = len(warnings)

print(f"[monitor-health] {datetime.now(timezone.utc).isoformat()}")
print(f"Banco: {size_mb:.1f}MB")
print(f"Problemas críticos: {total_issues}")
print(f"Avisos: {total_warnings}")

for issue in issues:
    print(f"  {issue}")
for warning in warnings:
    print(f"  {warning}")

# Abrir issue no GitHub se houver problemas críticos
if total_issues > 0:
    title = f"[Health Monitor] {total_issues} problema(s) crítico(s) — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    body = "## Problemas críticos encontrados\n\n"
    body += "\n".join(f"- {issue}" for issue in issues)
    if warnings:
        body += "\n\n## Avisos\n\n"
        body += "\n".join(f"- {warning}" for warning in warnings)
    body += f"\n\n---\n*Gerado automaticamente em {datetime.now(timezone.utc).isoformat()}*"

    response = requests.post(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/issues",
        headers={
            "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
            "Accept": "application/vnd.github+json",
        },
        json={
            "title": title,
            "body": body,
            "labels": ["health-monitor", "bug"],
        }
    )

    if response.status_code == 201:
        print(f"Issue aberta: {response.json()['html_url']}")
    else:
        print(f"Erro ao abrir issue: {response.status_code} {response.text}")
        exit(1)

    exit(1)  # falhar o workflow se há problemas críticos

print("✅ Tudo saudável")
