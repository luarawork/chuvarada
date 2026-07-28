"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
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

// Opções especiais do seletor -- "BR" e as 5 regiões do IBGE, resolvidas pro
// mesmo parâmetro ?region= tanto em /api/history quanto /api/reports (ver
// BRAZIL_REGIONS em lib/geo.ts, fonte única compartilhada com o backend).
const REGION_OPTIONS = [
  { value: "BR", label: "🇧🇷 Brasil inteiro" },
  { value: "norte", label: "🌿 Norte" },
  { value: "nordeste", label: "☀️ Nordeste" },
  { value: "sudeste", label: "🏙️ Sudeste" },
  { value: "sul", label: "🌲 Sul" },
  { value: "centro-oeste", label: "🌾 Centro-Oeste" },
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
  city_name?: string;
  state?: string;
}

interface ActiveUser {
  usuario: string;
  total_relatos: number;
  confirmacoes_recebidas: number;
  taxa_confirmacao: number | null;
  confiabilidade: number;
}

interface CoverageByState {
  state: string;
  municipios: number;
  bairros: number;
  pct_com_score: number | null;
  data_level_predominante: "full" | "partial" | "minimal";
  ultima_atualizacao: string | null;
}

interface GlobalMetrics {
  total_relatos: number;
  taxa_media_confirmacao: number | null;
  cidades_com_relatos: number;
  cobertura_dados: number | null;
  coverage_by_state: CoverageByState[];
}

interface RiskyNeighborhood {
  neighborhood_id: string;
  name: string;
  city: string;
  state: string;
  critical_count: number;
  last_event: string;
}

// Episódio contínuo de nível crítico num bairro -- construído client-side
// agrupando as leituras horárias já buscadas (não é uma tabela própria; ver
// risk_events pra um conceito parecido gravado direto pelo cron, mas essa
// página trabalha em cima do histórico já carregado, não requisita de novo).
interface CriticalEpisode {
  neighborhood_id: string;
  neighborhood_name: string;
  city_name: string;
  started_at: string;
  ended_at: string;
  duration_hours: number;
  max_score: number;
  confirmed_by_report: boolean;
}

// Ícone ℹ️ com tooltip explicativo -- CSS puro (group-hover), sem estado nem
// dependência nova, só pra dar contexto ao lado do título de cada seção
// (ver Item 6.1 do pedido).
function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1.5 inline-flex cursor-help align-middle" style={{ color: "#a8d4f0" }}>
      <span aria-hidden="true">ℹ️</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 w-64 -translate-x-1/2 rounded-lg border px-2.5 py-2 text-xs font-normal opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
        style={{ backgroundColor: "rgba(13, 27, 42, 0.98)", borderColor: "rgba(46, 125, 184, 0.4)", color: "#f0f4f8" }}
      >
        {text}
      </span>
    </span>
  );
}

function MetricCard({
  icon,
  label,
  value,
  onClick,
  active,
}: {
  icon: string;
  label: string;
  value: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className="w-full rounded-xl p-3 text-center transition"
      style={{
        backgroundColor: active ? "rgba(46, 125, 184, 0.25)" : "rgba(240, 244, 248, 0.06)",
        cursor: onClick ? "pointer" : "default",
        border: active ? "1px solid rgba(46, 125, 184, 0.5)" : "1px solid transparent",
      }}
    >
      <div className="text-lg">{icon}</div>
      <div className="mt-1 font-heading text-lg font-bold tabular-nums" style={{ color: "#f0f4f8" }}>
        {value}
      </div>
      <div className="mt-0.5 flex items-center justify-center gap-1 text-[11px]" style={{ color: "#a8d4f0" }}>
        {label}
        {onClick && <span aria-hidden="true">{active ? "▲" : "▼"}</span>}
      </div>
    </Tag>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days > 1 ? "s" : ""}`;
}

// Top 10 bairros por eventos críticos no período -- deriva dos mesmos
// `results` já buscados pelo handleSearch (um por dia/estado), sem endpoint
// próprio (ver Item 6.4 do pedido).
function buildRiskyNeighborhoods(results: { rows: HistoryRow[] }[]): RiskyNeighborhood[] {
  const map = new Map<string, RiskyNeighborhood>();
  for (const { rows } of results) {
    for (const row of rows) {
      if (row.level !== "critical") continue;
      const existing = map.get(row.neighborhood_id);
      if (existing) {
        existing.critical_count++;
        if (row.calculated_at > existing.last_event) existing.last_event = row.calculated_at;
      } else {
        map.set(row.neighborhood_id, {
          neighborhood_id: row.neighborhood_id,
          name: row.neighborhood_name ?? "Bairro",
          city: row.city_name ?? "—",
          state: row.state ?? "",
          critical_count: 1,
          last_event: row.calculated_at,
        });
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.critical_count - a.critical_count)
    .slice(0, 10);
}

// Agrupa leituras críticas consecutivas do MESMO bairro em episódios (gap
// de até 2h entre leituras ainda conta como o mesmo episódio -- cobre o caso
// de o cron pular um ciclo, ver diagnóstico de cron intermitente). Não lê
// risk_events (que já grava isso no servidor) porque esta página já tem o
// histórico completo em memória do handleSearch -- evita 1 requisição extra
// só pra duplicar o que já foi buscado.
const EPISODE_GAP_HOURS = 2;

function buildCriticalEpisodes(
  results: { rows: HistoryRow[] }[],
  reports: UserReport[]
): CriticalEpisode[] {
  const byNeighborhood = new Map<string, HistoryRow[]>();
  for (const { rows } of results) {
    for (const row of rows) {
      if (row.level !== "critical") continue;
      if (!byNeighborhood.has(row.neighborhood_id)) byNeighborhood.set(row.neighborhood_id, []);
      byNeighborhood.get(row.neighborhood_id)!.push(row);
    }
  }

  const episodes: CriticalEpisode[] = [];
  for (const [neighborhoodId, rows] of Array.from(byNeighborhood)) {
    rows.sort((a, b) => a.calculated_at.localeCompare(b.calculated_at));
    let current: HistoryRow[] = [];

    const flush = () => {
      if (current.length === 0) return;
      const started = current[0].calculated_at;
      const ended = current[current.length - 1].calculated_at;
      const durationHours = (new Date(ended).getTime() - new Date(started).getTime()) / 3_600_000;
      const windowStart = new Date(started).getTime() - 3_600_000;
      const windowEnd = new Date(ended).getTime() + 3_600_000;
      const confirmed = reports.some(
        (r) =>
          r.neighborhood_id === neighborhoodId &&
          new Date(r.created_at).getTime() >= windowStart &&
          new Date(r.created_at).getTime() <= windowEnd
      );
      episodes.push({
        neighborhood_id: neighborhoodId,
        neighborhood_name: current[0].neighborhood_name ?? "Bairro",
        city_name: current[0].city_name ?? "—",
        started_at: started,
        ended_at: ended,
        duration_hours: durationHours,
        max_score: Math.max(...current.map((r) => r.score)),
        confirmed_by_report: confirmed,
      });
      current = [];
    };

    for (const row of rows) {
      if (current.length === 0) {
        current.push(row);
        continue;
      }
      const gapHours =
        (new Date(row.calculated_at).getTime() - new Date(current[current.length - 1].calculated_at).getTime()) /
        3_600_000;
      if (gapHours <= EPISODE_GAP_HOURS) {
        current.push(row);
      } else {
        flush();
        current.push(row);
      }
    }
    flush();
  }

  return episodes.sort((a, b) => b.duration_hours - a.duration_hours);
}

interface DailyAggregate {
  date: string;
  max_score: number;
  avg_score: number;
  normal: number;
  attention: number;
  critical: number;
}

type Alignment =
  | "aligns"
  | "diverges_slightly"
  | "diverges_much"
  | "model_conservative"
  | "false_alarm"
  | "no_reports";

const ALIGNMENT_INFO: Record<Alignment, { label: string; icon: string; color: string }> = {
  aligns: { label: "Alinha", icon: "✅", color: COLORS.normal },
  diverges_slightly: { label: "Diverge levemente", icon: "⚠️", color: COLORS.attention },
  diverges_much: { label: "Diverge muito", icon: "🔴", color: COLORS.critical },
  model_conservative: { label: "Modelo mais conservador", icon: "🔵", color: "#a8d4f0" },
  false_alarm: { label: "Possível falso alarme", icon: "🔵", color: "#a8d4f0" },
  no_reports: { label: "Sem relatos", icon: "🔵", color: "#a8d4f0" },
};

// Ordem de gravidade da divergência em si (não do nível) -- usada só na
// lista expandida do card "Divergências encontradas" (ver Item 4).
const DIVERGENCE_SEVERITY_ORDER: Record<Alignment, number> = {
  diverges_much: 3,
  diverges_slightly: 2,
  false_alarm: 1,
  model_conservative: 1,
  aligns: 0,
  no_reports: 0,
};

// REPORT_SCORE começa em 1 (não 0 como SEVERITY_ORDER) -- um relato, mesmo
// "Leve", é sempre um evento real acontecendo, então nunca deveria "empatar"
// com o modelo em Normal (score 0) só por estarem ambos no índice mais
// baixo da própria escala. Com essa escala deslocada, diff = relato -
// modelo: Normal+Leve dá diff=+1 ("Diverge levemente", o modelo subestimou),
// e só Crítico+Grave (as duas escalas no topo) dá diff=0 ("Alinha").
const REPORT_SCORE: Record<ReportSeverity, number> = { leve: 1, moderado: 2, grave: 3 };

function getAlignment(modelLevel: RiskLevel, reportSeverity: ReportSeverity): Alignment {
  const diff = REPORT_SCORE[reportSeverity] - LEVEL_ORDER[modelLevel];
  if (diff === 0) return "aligns";
  if (diff === 1) return "diverges_slightly";
  if (diff >= 2) return "diverges_much";
  if (diff === -1) return "model_conservative";
  return "false_alarm";
}

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
    <div style={{ backgroundColor: "rgba(13, 27, 42, 0.95)", border: "1px solid rgba(46,125,184,0.3)", borderRadius: 8, padding: "8px 10px" }}>
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
        : getAlignment(model.level, reportBucket.maxSeverity);

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

// Painel de detalhe compartilhado pelos 4 cards que expandem (Item 4) --
// mesmo card escuro do resto da página, só com título + botão de fechar.
function ExpandedPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border p-4" style={{ backgroundColor: "rgba(240, 244, 248, 0.04)", borderColor: "rgba(46, 125, 184, 0.2)" }}>
      <h3 className="font-heading text-xs font-semibold uppercase tracking-wide" style={{ color: "#a8d4f0" }}>
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ExpandedTotalRelatos({
  reports,
  page,
  onPageChange,
  pageSize,
}: {
  reports: UserReport[];
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
}) {
  const sorted = [...reports].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <ExpandedPanel title="Relatos no período selecionado">
      {sorted.length === 0 ? (
        <p className="text-sm" style={{ color: "#a8d4f0" }}>
          Nenhum relato no período/estado selecionado nos filtros abaixo — busque um período pra ver a lista.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "rgba(46, 125, 184, 0.2)" }}>
                  <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Data/hora</th>
                  <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Gravidade</th>
                  <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Bairro/Cidade</th>
                  <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Status</th>
                  <th className="py-2 text-left font-medium" style={{ color: "#f0f4f8" }}>Confirmações</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0" style={{ borderColor: "rgba(46, 125, 184, 0.1)" }}>
                    <td className="py-2 pr-4 tabular-nums" style={{ color: "#f0f4f8" }}>
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: `${SEVERITY_COLOR[r.severity]}26`, color: SEVERITY_COLOR[r.severity] }}
                      >
                        {SEVERITY_LABEL[r.severity]}
                      </span>
                    </td>
                    <td className="py-2 pr-4" style={{ color: "#a8d4f0" }}>
                      {r.neighborhood_name ?? "—"}{r.city_name ? ` — ${r.city_name}` : ""}
                    </td>
                    <td className="py-2 pr-4" style={{ color: "#a8d4f0" }}>{r.status}</td>
                    <td className="py-2 tabular-nums" style={{ color: "#a8d4f0" }}>
                      ✓{r.confirmations} ✗{r.denials}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs" style={{ color: "#a8d4f0" }}>
              <button
                onClick={() => onPageChange(Math.max(0, page - 1))}
                disabled={page === 0}
                className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                style={{ borderColor: "rgba(240, 244, 248, 0.2)", color: "#f0f4f8" }}
              >
                ← Anterior
              </button>
              <span>Página {page + 1} de {totalPages}</span>
              <button
                onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                style={{ borderColor: "rgba(240, 244, 248, 0.2)", color: "#f0f4f8" }}
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}
    </ExpandedPanel>
  );
}

function ExpandedDivergencias({ rows }: { rows: HourlyComparison[] }) {
  const filtered = rows
    .filter((row) => row.alignment !== "aligns" && row.alignment !== "no_reports")
    .sort((a, b) => DIVERGENCE_SEVERITY_ORDER[b.alignment] - DIVERGENCE_SEVERITY_ORDER[a.alignment]);

  return (
    <ExpandedPanel title="Divergências entre relatos e modelo">
      {filtered.length === 0 ? (
        <p className="text-sm" style={{ color: "#a8d4f0" }}>
          Nenhuma divergência no período/estado selecionado.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "rgba(46, 125, 184, 0.2)" }}>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Horário</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Score modelo</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Nível</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Relatos</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Gravidade máx.</th>
                <th className="py-2 text-left font-medium" style={{ color: "#f0f4f8" }}>Tipo de divergência</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.hourKey} className="border-b last:border-0" style={{ borderColor: "rgba(46, 125, 184, 0.1)" }}>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: "#f0f4f8" }}>{row.label}</td>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>{row.model_score.toFixed(2)}</td>
                  <td className="py-2 pr-4">{LEVEL_LABEL[row.model_level]}</td>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>{row.report_count}</td>
                  <td className="py-2 pr-4">
                    {row.max_severity ? (
                      <span style={{ color: SEVERITY_COLOR[row.max_severity] }}>{SEVERITY_LABEL[row.max_severity]}</span>
                    ) : (
                      <span style={{ color: "#a8d4f0" }}>—</span>
                    )}
                  </td>
                  <td className="py-2">
                    <span style={{ color: ALIGNMENT_INFO[row.alignment].color }}>
                      {ALIGNMENT_INFO[row.alignment].icon} {ALIGNMENT_INFO[row.alignment].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ExpandedPanel>
  );
}

function ExpandedEventosCriticos({ episodes }: { episodes: CriticalEpisode[] }) {
  return (
    <ExpandedPanel title="Episódios em nível crítico no período">
      {episodes.length === 0 ? (
        <p className="text-sm" style={{ color: "#a8d4f0" }}>
          Nenhum bairro em nível crítico no período/estado selecionado.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "rgba(46, 125, 184, 0.2)" }}>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Bairro</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Cidade</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Duração</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Score máximo</th>
                <th className="py-2 text-left font-medium" style={{ color: "#f0f4f8" }}>Relato confirmando?</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((ep, i) => (
                <tr key={`${ep.neighborhood_id}-${ep.started_at}-${i}`} className="border-b last:border-0" style={{ borderColor: "rgba(46, 125, 184, 0.1)" }}>
                  <td className="py-2 pr-4" style={{ color: "#f0f4f8" }}>{ep.neighborhood_name}</td>
                  <td className="py-2 pr-4" style={{ color: "#a8d4f0" }}>{ep.city_name}</td>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>
                    {ep.duration_hours < 1 ? "< 1h" : `${Math.round(ep.duration_hours)}h`}
                  </td>
                  <td className="py-2 pr-4 tabular-nums font-semibold" style={{ color: COLORS.critical }}>
                    {ep.max_score.toFixed(2)}
                  </td>
                  <td className="py-2">
                    {ep.confirmed_by_report ? (
                      <span style={{ color: COLORS.normal }}>✅ Sim</span>
                    ) : (
                      <span style={{ color: "#a8d4f0" }}>— Não</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ExpandedPanel>
  );
}

const DATA_LEVEL_LABEL: Record<CoverageByState["data_level_predominante"], string> = {
  full: "Full",
  partial: "Partial",
  minimal: "Minimal",
};

function ExpandedCobertura({ rows }: { rows: CoverageByState[] }) {
  return (
    <ExpandedPanel title="Cobertura de dados por estado">
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "#a8d4f0" }}>Carregando...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "rgba(46, 125, 184, 0.2)" }}>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Estado</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Municípios</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>Bairros</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>% com score</th>
                <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>data_level predominante</th>
                <th className="py-2 text-left font-medium" style={{ color: "#f0f4f8" }}>Última atualização</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.state} className="border-b last:border-0" style={{ borderColor: "rgba(46, 125, 184, 0.1)" }}>
                  <td className="py-2 pr-4 font-semibold" style={{ color: "#f0f4f8" }}>{r.state}</td>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>{r.municipios}</td>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>{r.bairros.toLocaleString("pt-BR")}</td>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>
                    {r.pct_com_score != null ? `${r.pct_com_score}%` : "—"}
                  </td>
                  <td className="py-2 pr-4" style={{ color: "#a8d4f0" }}>{DATA_LEVEL_LABEL[r.data_level_predominante]}</td>
                  <td className="py-2" style={{ color: "#a8d4f0" }}>
                    {r.ultima_atualizacao ? relativeTime(r.ultima_atualizacao) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ExpandedPanel>
  );
}

// sessionStorage guarda a senha em si (mesmo padrão de app/sugestoes/page.tsx)
// -- some ao fechar a aba. A validação em si só confirma a senha contra
// ADMIN_PASSWORD (/api/analise/verify-password); as chamadas de dado da
// página (/api/history, /api/reports, etc.) continuam sem exigir o header,
// porque são compartilhadas com outras partes públicas do app.
const ANALISE_AUTH_STORAGE_KEY = "analise_auth";

export default function AnalisePage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const passwordRef = useRef("");

  const [state, setState] = useState("RN");
  const [startDate, setStartDate] = useState(todayMinus(6));
  const [endDate, setEndDate] = useState(todayMinus(0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [daily, setDaily] = useState<DailyAggregate[] | null>(null);
  const [criticalEvents, setCriticalEvents] = useState<HistoryRow[]>([]);
  const [reports, setReports] = useState<UserReport[]>([]);
  const [hourlyComparison, setHourlyComparison] = useState<HourlyComparison[]>([]);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [totalActiveUsers, setTotalActiveUsers] = useState(0);
  const [riskyNeighborhoods, setRiskyNeighborhoods] = useState<RiskyNeighborhood[]>([]);
  const [globalMetrics, setGlobalMetrics] = useState<GlobalMetrics | null>(null);
  const [historyResults, setHistoryResults] = useState<{ date: string; rows: HistoryRow[] }[]>([]);

  // Item 4: cards clicáveis com painel de detalhe expansível na mesma
  // página (não navega pra outra rota).
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [reportsPage, setReportsPage] = useState(0);
  const activeUsersSectionRef = useRef<HTMLDivElement>(null);
  const REPORTS_PAGE_SIZE = 20;

  function handleCardClick(cardId: string) {
    if (cardId === "usuarios_ativos") {
      // "auto" (instantâneo), não "smooth" -- smooth scroll depende de frames
      // de animação sendo processados, que navegadores throttleam/pulam em
      // abas em segundo plano (confirmado ao vivo: scrollIntoView com
      // behavior:"smooth" não avançava a página nesse cenário, "auto" sim).
      activeUsersSectionRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
      return;
    }
    setReportsPage(0);
    setExpandedCard((prev) => (prev === cardId ? null : cardId));
  }

  useEffect(() => {
    if (sessionStorage.getItem(ANALISE_AUTH_STORAGE_KEY)) {
      setAuthenticated(true);
    }
  }, []);

  async function handleAuth() {
    if (!passwordInput) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/analise/verify-password", {
        method: "POST",
        headers: { "x-admin-password": passwordInput },
      });
      if (res.status === 401) {
        setAuthError("Senha incorreta.");
        return;
      }
      if (!res.ok) {
        setAuthError("Falha ao verificar senha (erro do servidor).");
        return;
      }
      sessionStorage.setItem(ANALISE_AUTH_STORAGE_KEY, "1");
      setAuthenticated(true);
    } catch {
      setAuthError("Falha ao verificar senha.");
    } finally {
      setAuthLoading(false);
    }
  }

  // Cards "sem filtro de período" -- carregam uma vez, independente do
  // estado/período selecionado nos filtros abaixo (ver Item 6.3). Só depois
  // de autenticado, senão dispara antes do gate de senha renderizar o form.
  useEffect(() => {
    if (!authenticated) return;
    fetch("/api/analise/metrics")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setGlobalMetrics(data))
      .catch((err) => console.error("Erro ao buscar métricas gerais:", err));
  }, [authenticated]);

  async function handleSearch() {
    setLoading(true);
    setError(null);
    setDaily(null);
    setCriticalEvents([]);
    setReports([]);
    setHourlyComparison([]);
    setActiveUsers([]);
    setTotalActiveUsers(0);
    setRiskyNeighborhoods([]);
    setHistoryResults([]);
    setExpandedCard(null);

    try {
      const dates = dateRange(startDate, endDate);
      const results = await Promise.all(
        dates.map(async (date) => {
          const res = await fetch(`/api/history?region=${state}&date=${date}`);
          if (!res.ok) return { date, rows: [] as HistoryRow[] };
          const body = await res.json();
          return { date, rows: (body.data ?? []) as HistoryRow[] };
        })
      );

      const anyFound = results.some((r) => r.rows.length > 0);
      if (!anyFound) {
        setError("Nenhum dado encontrado pra essa seleção/período.");
        setLoading(false);
        return;
      }

      setHistoryResults(results);

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
      setRiskyNeighborhoods(buildRiskyNeighborhoods(results));

      try {
        const reportsRes = await fetch(`/api/reports?region=${state}&start=${startDate}&end=${endDate}`);
        if (reportsRes.ok) {
          const { reports: reportsData } = (await reportsRes.json()) as { reports: UserReport[] };
          setReports(reportsData);
          setHourlyComparison(buildHourlyComparison(results, reportsData));
        }
      } catch (err) {
        console.error("Erro ao buscar relatos do período:", err);
      }

      try {
        const activeUsersRes = await fetch(`/api/analise/active-users?region=${state}&start=${startDate}&end=${endDate}`);
        if (activeUsersRes.ok) {
          const { users, totalActiveUsers: total } = (await activeUsersRes.json()) as {
            users: ActiveUser[];
            totalActiveUsers: number;
          };
          setActiveUsers(users);
          setTotalActiveUsers(total);
        }
      } catch (err) {
        console.error("Erro ao buscar usuários ativos do período:", err);
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
  const divergenceCount = hourlyComparison.filter(
    (row) => row.alignment !== "aligns" && row.alignment !== "no_reports"
  ).length;

  if (!authenticated) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4" style={{ backgroundColor: "#0d1b2a" }}>
        <div
          className="w-full max-w-sm rounded-2xl border p-8"
          style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
        >
          <h1 className="font-heading text-xl font-bold" style={{ color: "#f0f4f8" }}>
            🔒 Área restrita
          </h1>
          <input
            type="password"
            placeholder="Senha"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            autoFocus
            className="mt-6 w-full rounded-lg border bg-white/10 px-4 py-3 text-sm outline-none placeholder:text-[#a8d4f0]/60"
            style={{ borderColor: "rgba(46, 125, 184, 0.3)", color: "#f0f4f8" }}
          />
          {authError && (
            <p className="mt-3 text-sm" style={{ color: "#d64045" }}>
              {authError}
            </p>
          )}
          <button
            onClick={handleAuth}
            disabled={authLoading || !passwordInput}
            className="mt-4 w-full rounded-lg py-3 text-sm font-semibold transition disabled:opacity-50"
            style={{ backgroundColor: "#2e7db8", color: "#f0f4f8" }}
          >
            {authLoading ? "Entrando..." : "Entrar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh" style={{ backgroundColor: "#0d1b2a" }}>
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

        {/* Métricas do produto */}
        <div
          className="mt-6 rounded-2xl border p-5"
          style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
        >
          <h2 className="font-heading text-sm font-semibold" style={{ color: "#f0f4f8" }}>
            Métricas do produto
          </h2>

          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <MetricCard
              icon="📍"
              label="Total de relatos"
              value={globalMetrics ? globalMetrics.total_relatos.toLocaleString("pt-BR") : "—"}
              onClick={() => handleCardClick("total_relatos")}
              active={expandedCard === "total_relatos"}
            />
            <MetricCard
              icon="✅"
              label="Taxa média de confirmação"
              value={globalMetrics?.taxa_media_confirmacao != null ? `${globalMetrics.taxa_media_confirmacao}%` : "—"}
            />
            <MetricCard
              icon="🗺️"
              label="Cidades com relatos"
              value={globalMetrics ? globalMetrics.cidades_com_relatos.toLocaleString("pt-BR") : "—"}
            />
            <MetricCard
              icon="📊"
              label="Cobertura de dados"
              value={globalMetrics?.cobertura_dados != null ? `${globalMetrics.cobertura_dados}%` : "—"}
              onClick={() => handleCardClick("cobertura_dados")}
              active={expandedCard === "cobertura_dados"}
            />
          </div>

          {daily && daily.length > 0 && (
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <MetricCard icon="📍" label="Relatos no período" value={reports.length.toLocaleString("pt-BR")} />
              <MetricCard
                icon="⚠️"
                label="Divergências encontradas"
                value={divergenceCount.toLocaleString("pt-BR")}
                onClick={() => handleCardClick("divergencias")}
                active={expandedCard === "divergencias"}
              />
              <MetricCard
                icon="🔴"
                label="Eventos críticos"
                value={criticalEvents.length.toLocaleString("pt-BR")}
                onClick={() => handleCardClick("eventos_criticos")}
                active={expandedCard === "eventos_criticos"}
              />
              <MetricCard
                icon="👥"
                label="Usuários ativos"
                value={totalActiveUsers.toLocaleString("pt-BR")}
                onClick={() => handleCardClick("usuarios_ativos")}
              />
            </div>
          )}

          {/* Painéis de detalhe expansíveis (Item 4) -- mesma página, sem navegação. */}
          {expandedCard === "total_relatos" && (
            <ExpandedTotalRelatos reports={reports} page={reportsPage} onPageChange={setReportsPage} pageSize={REPORTS_PAGE_SIZE} />
          )}
          {expandedCard === "cobertura_dados" && <ExpandedCobertura rows={globalMetrics?.coverage_by_state ?? []} />}
          {expandedCard === "divergencias" && <ExpandedDivergencias rows={hourlyComparison} />}
          {expandedCard === "eventos_criticos" && (
            <ExpandedEventosCriticos episodes={buildCriticalEpisodes(historyResults, reports)} />
          )}
        </div>

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
              <optgroup label="Regiões">
                {REGION_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value} style={{ color: "#1a3a5c" }}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Estados">
                {STATES.map((s) => (
                  <option key={s} value={s} style={{ color: "#1a3a5c" }}>
                    {s}
                  </option>
                ))}
              </optgroup>
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
                <InfoTooltip text="Evolução do score de risco ao longo do tempo. Score acima de 0,30 indica atenção; acima de 0,60 indica crítico." />
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
                <InfoTooltip text="Proporção de bairros em cada nível de risco ao longo do período selecionado." />
              </h2>
              <div className="mt-3 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a8d4f0" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#a8d4f0" }} />
                    <Tooltip contentStyle={{ backgroundColor: "rgba(13, 27, 42, 0.95)", border: "1px solid rgba(46,125,184,0.3)" }} labelStyle={{ color: "#f0f4f8" }} />
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
                <InfoTooltip text="Compara o que o modelo calculou com o que os usuários relataram. Divergências indicam onde o modelo pode estar subestimando o risco real." />
              </h2>

              <ul className="mt-2 space-y-0.5 text-xs" style={{ color: "#a8d4f0" }}>
                <li>✅ Alinha: modelo e relato no mesmo nível</li>
                <li>⚠️ Diverge levemente: relato 1 nível acima do modelo</li>
                <li>🔴 Diverge muito: relato 2 níveis acima (modelo subestimou)</li>
                <li>🔵 Modelo mais conservador: modelo acima do relato</li>
                <li>🔵 Possível falso alarme: modelo muito acima do relato</li>
              </ul>

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
                            <span style={{ color: ALIGNMENT_INFO[row.alignment].color }}>
                              {ALIGNMENT_INFO[row.alignment].icon} {ALIGNMENT_INFO[row.alignment].label}
                            </span>
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

            {/* Usuários mais ativos no período */}
            <div
              ref={activeUsersSectionRef}
              className="mt-6 rounded-2xl border p-5"
              style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
            >
              <h2 className="font-heading text-sm font-semibold" style={{ color: "#f0f4f8" }}>
                Usuários mais ativos no período
              </h2>
              {activeUsers.length === 0 ? (
                <p className="mt-2 text-sm" style={{ color: "#a8d4f0" }}>
                  Nenhum relato registrado nesse estado/período.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b" style={{ borderColor: "rgba(46, 125, 184, 0.2)" }}>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Usuário
                        </th>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Relatos
                        </th>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Confirmações recebidas
                        </th>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Taxa de confirmação
                        </th>
                        <th className="py-2 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Confiabilidade
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeUsers.map((u, i) => (
                        <tr key={`${u.usuario}-${i}`} className="border-b last:border-0" style={{ borderColor: "rgba(46, 125, 184, 0.1)" }}>
                          <td className="py-2 pr-4" style={{ color: "#f0f4f8" }}>
                            {u.usuario}
                          </td>
                          <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>
                            {u.total_relatos}
                          </td>
                          <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>
                            {u.confirmacoes_recebidas}
                          </td>
                          <td className="py-2 pr-4 tabular-nums" style={{ color: "#a8d4f0" }}>
                            {u.taxa_confirmacao !== null ? `${u.taxa_confirmacao}%` : "—"}
                          </td>
                          <td className="py-2" style={{ color: "#f0a500" }}>
                            {u.confiabilidade > 0 ? "⭐".repeat(u.confiabilidade) : <span style={{ color: "#a8d4f0" }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Pontos de risco recorrentes */}
            <div
              className="mt-6 rounded-2xl border p-5"
              style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
            >
              <h2 className="font-heading text-sm font-semibold" style={{ color: "#f0f4f8" }}>
                Pontos de risco recorrentes
              </h2>
              <p className="mt-1 text-xs" style={{ color: "#a8d4f0" }}>
                Top 10 bairros com mais eventos críticos no período selecionado.
              </p>
              {riskyNeighborhoods.length === 0 ? (
                <p className="mt-2 text-sm" style={{ color: "#a8d4f0" }}>
                  Nenhum bairro em nível crítico nesse estado/período.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b" style={{ borderColor: "rgba(46, 125, 184, 0.2)" }}>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Bairro
                        </th>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Cidade
                        </th>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Estado
                        </th>
                        <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Eventos críticos
                        </th>
                        <th className="py-2 text-left font-medium" style={{ color: "#f0f4f8" }}>
                          Último evento
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {riskyNeighborhoods.map((n) => (
                        <tr key={n.neighborhood_id} className="border-b last:border-0" style={{ borderColor: "rgba(46, 125, 184, 0.1)" }}>
                          <td className="py-2 pr-4" style={{ color: "#f0f4f8" }}>
                            {n.name}
                          </td>
                          <td className="py-2 pr-4" style={{ color: "#a8d4f0" }}>
                            {n.city}
                          </td>
                          <td className="py-2 pr-4" style={{ color: "#a8d4f0" }}>
                            {n.state}
                          </td>
                          <td className="py-2 pr-4 tabular-nums font-semibold" style={{ color: COLORS.critical }}>
                            {n.critical_count}
                          </td>
                          <td className="py-2" style={{ color: "#a8d4f0" }}>
                            {relativeTime(n.last_event)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
