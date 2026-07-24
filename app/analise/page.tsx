"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ReferenceArea,
  Tooltip,
  Legend,
} from "recharts";

// Paleta consistente com o resto do app (RISK_COLORS em lib/geojson.ts,
// mesmo card escuro de components/ui/AlertCard.tsx).
const COLORS = { normal: "#2a9d72", attention: "#f0a500", critical: "#d64045", line: "#2e7db8" };

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

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function AnalisePage() {
  const [state, setState] = useState("RN");
  const [startDate, setStartDate] = useState(todayMinus(6));
  const [endDate, setEndDate] = useState(todayMinus(0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [daily, setDaily] = useState<DailyAggregate[] | null>(null);
  const [criticalEvents, setCriticalEvents] = useState<HistoryRow[]>([]);

  async function handleSearch() {
    setLoading(true);
    setError(null);
    setDaily(null);
    setCriticalEvents([]);

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
    } catch {
      setError("Falha ao buscar histórico.");
    } finally {
      setLoading(false);
    }
  }

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
                  <LineChart data={daily} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <ReferenceArea y1={0} y2={0.3} fill={COLORS.normal} fillOpacity={0.08} />
                    <ReferenceArea y1={0.3} y2={0.6} fill={COLORS.attention} fillOpacity={0.08} />
                    <ReferenceArea y1={0.6} y2={1} fill={COLORS.critical} fillOpacity={0.08} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a8d4f0" }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: "#a8d4f0" }} />
                    <Tooltip
                      formatter={(value) => (typeof value === "number" ? value.toFixed(2) : value)}
                      contentStyle={{ backgroundColor: "#1a3a5c", border: "1px solid rgba(46,125,184,0.3)" }}
                      labelStyle={{ color: "#f0f4f8" }}
                    />
                    <Line type="monotone" dataKey="max_score" name="Score máximo" stroke={COLORS.line} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="avg_score" name="Score médio" stroke="#a8d4f0" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
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

            {/* Placeholder pra relatos futuros */}
            <div
              className="mt-6 rounded-2xl border border-dashed p-5 text-center text-sm"
              style={{ borderColor: "rgba(46, 125, 184, 0.3)", color: "#a8d4f0" }}
            >
              Em breve: relatos de moradores sobre eventos de alagamento nesta área.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
