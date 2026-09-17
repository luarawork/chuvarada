#!/usr/bin/env python3
"""Monitor de saúde operacional do Chuvarada.
Roda diariamente via GitHub Actions.
Abre issue no GitHub se encontrar problemas."""

import os
import psycopg2
import requests
from datetime import datetime, timezone


def get_existing_health_issue(github_token: str, repo: str) -> dict | None:
    """Busca issue aberta com label health-monitor -- evita criar uma issue
    nova a cada execução (achado em 17/09/2026: 21 issues idênticas
    acumuladas em 21 dias corridos, nunca fechadas, ver docs/reports/)."""
    response = requests.get(
        f"https://api.github.com/repos/{repo}/issues",
        headers={
            "Authorization": f"Bearer {github_token}",
            "Accept": "application/vnd.github+json",
        },
        params={
            "state": "open",
            "labels": "health-monitor",
            "per_page": 1,
        },
    )
    response.raise_for_status()
    found = response.json()
    return found[0] if found else None


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

# 1.2 risk_scores com linhas > 48h (archive não drenando) -- limiar elevado
# de 24h pra 48h em 21/08/2026: archive roda 2x/dia (02h e 14h UTC), então o
# backlog legítimo entre execuções nunca passa de ~36h (verificado em
# 21/08/2026: ~228 mil linhas de backlog normal, só 7,5h após a última
# execução, geravam falso positivo com o limiar de 24h). 48h dá margem
# segura acima do pior caso real.
# archived_at IS NULL (migração 045, 19/08/2026): linha já marcada como
# arquivada já tem backup garantido no B2, só falta o DELETE (que roda logo
# em seguida no mesmo archive, ver deleteArchivedRiskScores) -- contar essas
# como "backlog não drenado" gerava falso positivo.
cur.execute("""
    SELECT COUNT(*), MIN(calculated_at)
    FROM risk_scores
    WHERE calculated_at < NOW() - INTERVAL '48 hours'
    AND archived_at IS NULL
""")
old_scores, oldest = cur.fetchone()

cur.execute("""
    SELECT COUNT(*)
    FROM risk_scores
    WHERE calculated_at < NOW() - INTERVAL '36 hours'
    AND archived_at IS NULL
""")
old_scores_36h = cur.fetchone()[0]

if old_scores and old_scores > 10000:
    issues.append(
        f"🔴 {old_scores:,} linhas de risk_scores com >48h sem arquivar "
        f"(mais antiga: {oldest}). Archive pode não estar drenando — "
        f"com execuções 2x/dia, backlog legítimo nunca passa de ~36h."
    )
elif old_scores_36h and old_scores_36h > 0:
    warnings.append(
        f"🟡 {old_scores_36h:,} linhas de risk_scores com >36h sem arquivar"
    )

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
# Limiar de 2h pra 6h em 17/09/2026: investigação real (GitHub Actions run
# history de merge-and-scores-update.yml) mostrou que o cron de scores roda
# a cada ~5-6h na prática, não a cada 1h como o "0 * * * *" declarado
# sugere -- o scheduler do GitHub atrasa/descarta triggers sob carga (esse
# repo tem vários workflows agendados competindo). Com limiar de 2h, o
# alerta disparava quase todo dia mesmo com o cron funcionando dentro do
# padrão real dele -- 21 issues idênticas em 21 dias corridos, ver
# docs/reports/. 6h dá margem acima da cadência real observada.
cur.execute("""
    SELECT COUNT(*)
    FROM cities c
    WHERE c.active = true
    AND NOT EXISTS (
        SELECT 1 FROM city_risk_summary crs
        WHERE crs.city_id = c.id
        AND crs.last_updated > NOW() - INTERVAL '6 hours'
    )
""")
stale_cities = cur.fetchone()[0]
if stale_cities > 100:
    issues.append(
        f"🔴 {stale_cities} cidades com score desatualizado (>6h). "
        f"Verificar GitHub Actions — cadência real do scheduler é ~5-6h."
    )
elif stale_cities > 0:
    warnings.append(f"🟡 {stale_cities} cidades com score desatualizado (>6h)")

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

# 3.2 merge_cache com linhas > 5 dias (retenção violada) -- limiar elevado
# de 4 pra 5 dias em 21/08/2026: archive roda 2x/dia, então o backlog
# legítimo de merge_cache near nunca passa de ~12h além do corte de
# retenção de 4 dias (MERGE_CACHE_NEAR_RETENTION_DAYS em archive_to_b2.ts).
# 5 dias dá margem segura sem gerar falso positivo crônico.
cur.execute("""
    SELECT COUNT(*)
    FROM merge_cache
    WHERE fetched_at < NOW() - INTERVAL '5 days'
    AND is_near_neighborhood = true
""")
old_merge = cur.fetchone()[0]
if old_merge > 0:
    issues.append(
        f"🔴 {old_merge:,} linhas de merge_cache próximo com >5 dias "
        f"(retenção alvo: 4 dias). Archive pode não estar drenando."
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
        f"Weather cache pode estar desatualizado — verificar GitHub Actions."
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

# Issue única por ciclo de problema: busca uma issue aberta com label
# health-monitor, comenta nela se já existir, cria só se não existir, e
# fecha automaticamente quando os problemas críticos somem -- em vez de
# criar uma issue nova a cada execução (era o comportamento antigo, ver
# comentário na função get_existing_health_issue acima).
github_headers = {
    "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
    "Accept": "application/vnd.github+json",
}
github_repo = os.environ['GITHUB_REPOSITORY']
existing = get_existing_health_issue(os.environ['GITHUB_TOKEN'], github_repo)

if total_issues > 0:
    title = "[Health Monitor] Problemas críticos detectados"
    body = "## Problemas críticos encontrados\n\n"
    body += "\n".join(f"- {issue}" for issue in issues)
    if warnings:
        body += "\n\n## Avisos\n\n"
        body += "\n".join(f"- {warning}" for warning in warnings)
    body += f"\n\n---\n*Gerado automaticamente em {datetime.now(timezone.utc).isoformat()}*"

    if existing:
        response = requests.post(
            f"https://api.github.com/repos/{github_repo}/issues/{existing['number']}/comments",
            headers=github_headers,
            json={"body": body},
        )
        if response.status_code == 201:
            print(f"Comentário adicionado na issue #{existing['number']}")
        else:
            print(f"Erro ao comentar na issue #{existing['number']}: {response.status_code} {response.text}")
            exit(1)
    else:
        response = requests.post(
            f"https://api.github.com/repos/{github_repo}/issues",
            headers=github_headers,
            json={
                "title": title,
                "body": body,
                "labels": ["health-monitor", "bug"],
            },
        )
        if response.status_code == 201:
            print(f"Issue aberta: {response.json()['html_url']}")
        else:
            print(f"Erro ao abrir issue: {response.status_code} {response.text}")
            exit(1)

    exit(1)  # falhar o workflow se há problemas críticos

elif existing:
    # Sem problemas críticos agora, mas havia uma issue aberta -- fecha
    # automaticamente em vez de deixar pendurada esperando alguém notar.
    close_response = requests.patch(
        f"https://api.github.com/repos/{github_repo}/issues/{existing['number']}",
        headers=github_headers,
        json={"state": "closed"},
    )
    if close_response.status_code == 200:
        requests.post(
            f"https://api.github.com/repos/{github_repo}/issues/{existing['number']}/comments",
            headers=github_headers,
            json={
                "body": "✅ Problemas resolvidos — fechando automaticamente.\n\n"
                f"*{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}*"
            },
        )
        print(f"Issue #{existing['number']} fechada automaticamente")
    else:
        print(f"Erro ao fechar issue #{existing['number']}: {close_response.status_code} {close_response.text}")

print("✅ Tudo saudável")
