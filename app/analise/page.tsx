"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ReferenceArea,
  Tooltip,
  Legend,
} from "recharts";
import type { ReportSeverity, RiskLevel, UserReport } from "@/types";

// Paleta consistente com o resto do app (RISK_COLORS em lib/geojson.ts,
// mesmo card escuro de components/ui/AlertCard.tsx).
const COLORS = { normal: "#2a9d72", attention: "#f0a500", critical: "#d64045", line: "#2e7db8" };

const SEVERITY_COLOR: Record<ReportSeverity, string> = {
  leve: "#a8d4f0",
  moderado: "#f0a500",
  grave: "#d64045",
};

const SEVERITY_LABEL: Record<ReportSeverity, string> = {
  leve: "Leve",
  moderado: "Moderado",
  grave: "Grave",
};

const SEVERITY_ORDER: Record<ReportSeverity, number> = { leve: 0, moderado: 1, grave: 2 };
const LEVEL_ORDER: Record<RiskLevel, number> = { normal: 0, attention: 1, critical: 2 };

const LEVEL_LABEL: Record<RiskLevel, string> = {
  normal: "🟢 Normal",
  attention: "🟡 Atenção",
  critical: "🔴 Crítico",
};

const STATES = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

interface HistoryRow {
  neighborhood_id: string;
  score: number;
  level: "normal" | "attention" | "critical";
  rain_72h: number;
  auto_critical: boolean;
  auto_critical_reason: string | null;
  calculated_at: string;
  neighborhood_name?: string;
}

interface DailyAggregate {
  date: string;
  max_score: number;
  avg_score: number;
  normal: number;
  attention: number;
  critical: number;
}

type Alignment = "aligns" | "diverges" | "no_reports";

interface HourlyComparison {
  hourKey: string; // "2026-07-18T14"
  label: string; // "18/07 14:00"
  model_score: number;
  model_level: RiskLevel;
  report_count: number;
  max_severity: ReportSeverity | null;
  alignment: Alignment;
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

interface ScoreTooltipEntry {
  dataKey?: string;
  name?: string;
  value?: number;
  color?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

function ScoreChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ScoreTooltipEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ backgroundColor: "#1a3a5c", border: "1px solid rgba(46,125,184,0.3)", borderRadius: 8, padding: "8px 10px" }}>
      <p style={{ color: "#f0f4f8", fontSize: 12, marginBottom: 4, fontWeight: 600 }}>{label}</p>
      {payload.map((entry, i) => {
        if (entry.dataKey === "report_score") {
          const p = entry.payload as { severity: ReportSeverity; time: string; confirmations: number };
          return (
            <p key={i} style={{ color: SEVERITY_COLOR[p.severity], fontSize: 12 }}>
              Relato {SEVERITY_LABEL[p.severity]} — {p.time} · {p.confirmations} confirmações
            </p>
          );
        }
        return (
          <p key={i} style={{ color: entry.color, fontSize: 12 }}>
            {entry.name}: {typeof entry.value === "number" ? entry.value.toFixed(2) : entry.value}
          </p>
        );
      })}
    </div>
  );
}

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Cruza o score do modelo (pior caso por hora, entre todos os bairros do
// estado) com os relatos da comunidade na mesma hora -- só gera linha pra
// horas que tiveram relato OU que o modelo já considerava atenção/crítico
// (uma hora "normal" e sem relato não tem o que comparar).
function buildHourlyComparison(
  results: { date: string; rows: HistoryRow[] }[],
  reports: UserReport[]
): HourlyComparison[] {
  const modelByHour = new Map<string, { score: number; level: RiskLevel }>();
  for (const { rows } of results) {
    for (const row of rows) {
      const hourKey = row.calculated_at.slice(0, 13);
      const existing = modelByHour.get(hourKey);
      if (!existing || row.score > existing.score) {
        modelByHour.set(hourKey, { score: row.score, level: row.level });
      }
    }
  }

  const reportsByHour = new Map<string, { count: number; maxSeverity: ReportSeverity }>();
  for (const r of reports) {
    const hourKey = r.created_at.slice(0, 13);
    const existing = reportsByHour.get(hourKey);
    if (!existing) {
      reportsByHour.set(hourKey, { count: 1, maxSeverity: r.severity });
    } else {
      existing.count++;
      if (SEVERITY_ORDER[r.severity] > SEVERITY_ORDER[existing.maxSeverity]) existing.maxSeverity = r.severity;
    }
  }

  const hourKeys = new Set<string>(reportsByHour.keys());
  for (const [key, model] of Array.from(modelByHour)) {
    if (model.level !== "normal") hourKeys.add(key);
  }

  return Array.from(hourKeys)
    .sort()
    .map((hourKey) => {
      const model = modelByHour.get(hourKey) ?? { score: 0, level: "normal" as RiskLevel };
      const reportBucket = reportsByHour.get(hourKey);
      const alignment: Alignment = !reportBucket
        ? "no_reports"
        : SEVERITY_ORDER[reportBucket.maxSeverity] > LEVEL_ORDER[model.level]
          ? "diverges"
          : "aligns";

      const [datePart, hourPart] = hourKey.split("T");
      const [, month, day] = datePart.split("-");

      return {
        hourKey,
        label: `${day}/${month} ${hourPart}:00`,
        model_score: model.score,
        model_level: model.level,
        report_count: reportBucket?.count ?? 0,
        max_severity: reportBucket?.maxSeverity ?? null,
        alignment,
      };
    });
}

// Diferente da tabela hora-a-hora (que compara o PIOR caso do estado com os
// relatos), estas métricas usam o contexto do modelo já embutido em cada
// relato na hora da criação (model_level/model_score, ver app/api/reports/
// route.ts) -- mais preciso porque compara o relato com o score exato do
// bairro relatado, não o pior bairro do estado naquela hora.
function computeAlignmentMetrics(reports: UserReport[]) {
  const graves = reports.filter((r) => r.severity === "grave");
  const moderados = reports.filter((r) => r.severity === "moderado");

  const pctGraveCritical = graves.length
    ? (graves.filter((r) => r.model_level === "critical").length / graves.length) * 100
    : null;
  const pctModeradoAtencaoOuCritico = moderados.length
    ? (moderados.filter((r) => r.model_level === "attention" || r.model_level === "critical").length / moderados.length) * 100
    : null;
  const pctNormalModel = reports.length
    ? (reports.filter((r) => r.model_level === "normal").length / reports.length) * 100
    : null;

  return { pctGraveCritical, pctModeradoAtencaoOuCritico, pctNormalModel };
}

export default function AnalisePage() {
  const [state, setState] = useState("RN");
  const [startDate, setStartDate] = useState(todayMinus(6));
  const [endDate, setEndDate] = useState(todayMinus(0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [daily, setDaily] = useState<DailyAggregate[] | null>(null);
  const [criticalEvents, setCriticalEvents] = useState<HistoryRow[]>([]);
  const [reports, setReports] = useState<UserReport[]>([]);
  const [hourlyComparison, setHourlyComparison] = useState<HourlyComparison[]>([]);

  async function handleSearch() {
    setLoading(true);
    setError(null);
    setDaily(null);
    setCriticalEvents([]);
    setReports([]);
    setHourlyComparison([]);

    try {
      const dates = dateRange(startDate, endDate);
      const results = await Promise.all(
        dates.map(async (date) => {
          const res = await fetch(`/api/history?state=${state}&date=${date}`);
          if (!res.ok) return { date, rows: [] as HistoryRow[] };
          const body = await res.json();
          return { date, rows: (body.data ?? []) as HistoryRow[] };
        })
      );

      const anyFound = results.some((r) => r.rows.length > 0);
      if (!anyFound) {
        setError("Nenhum dado encontrado pra esse estado/período.");
        setLoading(false);
        return;
      }

      const aggregates: DailyAggregate[] = results.map(({ date, rows }) => {
        const scores = rows.map((r) => r.score);
        const counts = { normal: 0, attention: 0, critical: 0 };
        for (const r of rows) counts[r.level]++;
        return {
          date,
          max_score: scores.length ? Math.max(...scores) : 0,
          avg_score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
          ...counts,
        };
      });
      setDaily(aggregates);

      const allCritical = results
        .flatMap((r) => r.rows)
        .filter((r) => r.level === "critical")
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      setCriticalEvents(allCritical);

      try {
        const reportsRes = await fetch(`/api/reports?state=${state}&start=${startDate}&end=${endDate}`);
        if (reportsRes.ok) {
          const { reports: reportsData } = (await reportsRes.json()) as { reports: UserReport[] };
          setReports(reportsData);
          setHourlyComparison(buildHourlyComparison(results, reportsData));
        }
      } catch (err) {
        console.error("Erro ao buscar relatos do período:", err);
      }
    } catch {
      setError("Falha ao buscar histórico.");
    } finally {
      setLoading(false);
    }
  }

  const reportsForChart = reports
    .filter((r) => daily?.some((d) => d.date === r.created_at.slice(0, 10)))
    .map((r) => ({
      date: r.created_at.slice(0, 10),
      report_score: r.model_score ?? 0.05,
      severity: r.severity,
      confirmations: r.confirmations,
      time: new Date(r.created_at).toLocaleString("pt-BR"),
    }));

  const alignmentMetrics = computeAlignmentMetrics(reports);

  return (
    <div className="min-h-dvh" style={{ backgroundColor: "#1a3a5c" }}>
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/" className="text-sm hover:underline" style={{ color: "#a8d4f0" }}>
          ← Voltar para o mapa
        </Link>

        <h1 className="mt-4 font-heading text-2xl font-bold md:text-3xl" style={{ color: "#f0f4f8" }}>
          Análise Histórica
        </h1>
        <p className="mt-1 text-sm" style={{ color: "#a8d4f0" }}>
          Evolução do risco de alagamento por estado e período.
        </p>

        {/* Filtros */}
        <div
          className="mt-6 flex flex-wrap items-end gap-4 rounded-2xl border p-5"
          style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
        >
          <label className="flex flex-col gap-1 text-xs" style={{ color: "#a8d4f0" }}>
            Estado
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="rounded-lg border-none bg-white/10 px-3 py-2 text-sm"
              style={{ color: "#f0f4f8" }}
            >
              {STATES.map((s) => (
                <option key={s} value={s} style={{ color: "#1a3a5c" }}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "#a8d4f0" }}>
            De
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border-none bg-white/10 px-3 py-2 text-sm"
              style={{ color: "#f0f4f8", colorScheme: "dark" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "#a8d4f0" }}>
            Até
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border-none bg-white/10 px-3 py-2 text-sm"
              style={{ color: "#f0f4f8", colorScheme: "dark" }}
            />
          </label>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: "#2e7db8", color: "#f0f4f8" }}
          >
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </div>

        {error && (
          <p className="mt-4 text-sm" style={{ color: COLORS.critical }}>
            {error}
          </p>
        )}

        {daily && daily.length > 0 && (
          <>
            {/* Gráfico 1: linha do tempo de score máximo */}
            <div
              className="mt-6 rounded-2xl border p-5"
              style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
            >
              <h2 className="font-heading text-sm font-semibold" style={{ color: "#f0f4f8" }}>
                Score máximo por dia
              </h2>
              <div className="mt-3 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={daily} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <ReferenceArea y1={0} y2={0.3} fill={COLORS.normal} fillOpacity={0.08} />
                    <ReferenceArea y1={0.3} y2={0.6} fill={COLORS.attention} fillOpacity={0.08} />
                    <ReferenceArea y1={0.6} y2={1} fill={COLORS.critical} fillOpacity={0.08} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a8d4f0" }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: "#a8d4f0" }} />
                    <Tooltip content={<ScoreChartTooltip />} />
                    <Line type="monotone" dataKey="max_score" name="Score máximo" stroke={COLORS.line} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="avg_score" name="Score médio" stroke="#a8d4f0" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                    <Scatter
                      data={reportsForChart}
                      dataKey="report_score"
                      name="Relatos"
                      shape={(props: unknown) => {
                        const p = props as { cx: number; cy: number; payload: { severity: ReportSeverity } };
                        return <circle cx={p.cx} cy={p.cy} r={5} fill={SEVERITY_COLOR[p.payload.severity]} stroke="#0d1b2a" strokeWidth={1.5} />;
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: "#a8d4f0" }}>
                <span>🔵 Leve</span>
                <span>🟡 Moderado</span>
                <span>🔴 Grave</span>
                <span className="opacity-60">— relatos da comunidade sobre o score do modelo na hora</span>
              </div>
            </div>

            {/* Gráfico 2: distribuição de risco */}
            <div
              className="mt-6 rounded-2xl border p-5"
              style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
            >
              <h2 className="font-heading text-sm font-semibold" style={{ color: "#f0f4f8" }}>
                Distribuição de risco por dia
              </h2>
              <div className="mt-3 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a8d4f0" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#a8d4f0" }} />
                    <Tooltip contentStyle={{ backgroundColor: "#1a3a5c", border: "1px solid rgba(46,125,184,0.3)" }} labelStyle={{ color: "#f0f4f8" }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: "#a8d4f0" }} />
                    <Bar dataKey="normal" name="Normal" stackId="a" fill={COLORS.normal} />
                    <Bar dataKey="attention" name="Atenção" stackId="a" fill={COLORS.attention} />
                    <Bar dataKey="critical" name="Crítico" stackId="a" fill={COLORS.critical} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Lista: eventos críticos */}
            <div
              className="mt-6 rounded-2xl border p-5"
              style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
            >
              <h2 className="font-heading text-sm font-semibold" style={{ color: "#f0f4f8" }}>
                Eventos críticos do período
              </h2>
              {criticalEvents.length === 0 ? (
                <p className="mt-2 text-sm" style={{ color: "#a8d4f0" }}>
                  Nenhum bairro em nível crítico nesse período.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {criticalEvents.map((ev, i) => (
                    <li
                      key={`${ev.neighborhood_id}-${ev.calculated_at}-${i}`}
                      className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
                      style={{ backgroundColor: "rgba(214, 64, 69, 0.12)" }}
                    >
                      <span style={{ color: "#f0f4f8" }}>
                        {ev.neighborhood_name ?? "Bairro"}
                        <span style={{ color: "#a8d4f0" }}> — {new Date(ev.calculated_at).toLocaleString("pt-BR")}</span>
                      </span>
                      <span className="font-semibold" style={{ color: COLORS.critical }}>
                        {ev.score.toFixed(2)}
                        {ev.auto_critical_reason ? ` · ${ev.auto_critical_reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Lista: relatos de moradores no período */}
            <div
              className="mt-6 rounded-2xl border p-5"
              style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
            >
              <h2 className="font-heading text-sm font-semibold" style={{ color: "#f0f4f8" }}>
                Relatos de moradores no período
              </h2>
              {reports.length === 0 ? (
                <p className="mt-2 text-sm" style={{ color: "#a8d4f0" }}>
                  Nenhum relato registrado nesse estado/período.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {reports.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm"
                      style={{ backgroundColor: "rgba(240, 244, 248, 0.06)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: SEVERITY_COLOR[r.severity] }}
                        />
                        <span style={{ color: "#f0f4f8" }}>
                          {SEVERITY_LABEL[r.severity]}
                          <span style={{ color: "#a8d4f0" }}> — {new Date(r.created_at).toLocaleString("pt-BR")}</span>
                        </span>
                      </div>
                      <span className="text-xs" style={{ color: "#a8d4f0" }}>
                        ✓{r.confirmations} ✗{r.denials}
                        {r.model_level && r.model_level !== "normal" ? ` · modelo em ${r.model_level === "critical" ? "crítico" : "atenção"}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Relatos vs Modelo */}
            <div
              className="mt-6 rounded-2xl border p-5"
              style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
            >
              <h2 className="font-heading text-sm font-semibold" style={{ color: "#f0f4f8" }}>
                Relatos vs Modelo
              </h2>

              {hourlyComparison.length === 0 ? (
                <p className="mt-2 text-sm" style={{ color: "#a8d4f0" }}>
                  Sem horas com relato ou alerta do modelo nesse estado/período pra comparar.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b" style={{ borderColor: "rgba(46, 125, 184, 0.2)" }}>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Horário
                        </th>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Score modelo
                        </th>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Nível modelo
                        </th>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Relatos
                        </th>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Gravidade máx.
                        </th>
                        <th className="py-2 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Alinhado?
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {hourlyComparison.map((row) => (
                        <tr key={row.hourKey} className="border-b last:border-0" style={{ borderColor: "rgba(46, 125, 184, 0.1)" }}>
                          <td className="py-2 pr-4 tabular-nums" style={{ color: "#f0f4f8" }}>
                            {row.label}
                          </td>
                          <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>
                            {row.model_score.toFixed(2)}
                          </td>
                          <td className="py-2 pr-4">{LEVEL_LABEL[row.model_level]}</td>
                          <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>
                            {row.report_count}
                          </td>
                          <td className="py-2 pr-4">
                            {row.max_severity ? (
                              <span style={{ color: SEVERITY_COLOR[row.max_severity] }}>
                                🔴 {SEVERITY_LABEL[row.max_severity]}
                              </span>
                            ) : (
                              <span style={{ color: "#a8d4f0" }}>—</span>
                            )}
                          </td>
                          <td className="py-2">
                            {row.alignment === "no_reports" && <span style={{ color: "#a8d4f0" }}>🔵 Sem relatos</span>}
                            {row.alignment === "aligns" && <span style={{ color: COLORS.normal }}>✅ Alinha</span>}
                            {row.alignment === "diverges" && <span style={{ color: COLORS.attention }}>⚠️ Diverge</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl p-3 text-xs" style={{ backgroundColor: "rgba(240, 244, 248, 0.06)", color: "#a8d4f0" }}>
                  {alignmentMetrics.pctGraveCritical !== null
                    ? `${alignmentMetrics.pctGraveCritical.toFixed(0)}% dos relatos graves coincidiram com nível crítico do modelo`
                    : "Sem relatos graves nesse período"}
                </div>
                <div className="rounded-xl p-3 text-xs" style={{ backgroundColor: "rgba(240, 244, 248, 0.06)", color: "#a8d4f0" }}>
                  {alignmentMetrics.pctModeradoAtencaoOuCritico !== null
                    ? `${alignmentMetrics.pctModeradoAtencaoOuCritico.toFixed(0)}% dos relatos moderados coincidiram com atenção ou crítico`
                    : "Sem relatos moderados nesse período"}
                </div>
                <div className="rounded-xl p-3 text-xs" style={{ backgroundColor: "rgba(240, 244, 248, 0.06)", color: "#a8d4f0" }}>
                  {alignmentMetrics.pctNormalModel !== null
                    ? `${alignmentMetrics.pctNormalModel.toFixed(0)}% dos relatos ocorreram com o modelo em nível normal — possível subestimação`
                    : "Sem relatos nesse período"}
                </div>
              </div>

              <p className="mt-4 text-xs italic" style={{ color: "#a8d4f0" }}>
                Esta comparação é experimental. Estamos usando os relatos para calibrar o modelo —
                divergências nos ajudam a identificar onde o Chuvarada precisa melhorar.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
