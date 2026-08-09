"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, ReferenceArea, Tooltip } from "recharts";
import type { RiskLevel, RiskScore } from "@/types";
import { RISK_COLORS, SCORE_THRESHOLDS } from "@/lib/constants";

const LEVEL_LABELS: Record<RiskLevel, string> = {
  normal: "normal",
  attention: "atenção",
  moderate: "moderado",
  high: "alto",
  critical: "crítico",
};

interface ScoreHistoryProps {
  history: RiskScore[];
}

interface HistoryPoint {
  time: string;
  score: number;
  level: RiskLevel;
  auto_critical: boolean;
  auto_critical_reason: string | null;
}

// Ponto colorido pelo `level` gravado (que pode ser 'critical' por regra de
// auto-crítico mesmo com score moderado, ver lib/score.ts) -- não pelo valor
// de score, que sozinho classificaria por faixa e esconderia esses casos.
// Auto-crítico ganha um anel extra pra ficar visualmente distinto de um
// crítico "normal" (score alto).
function HistoryDot(props: { cx?: number; cy?: number; payload?: HistoryPoint }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  const color = RISK_COLORS[payload.level];
  if (payload.auto_critical) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} />
        <circle cx={cx} cy={cy} r={3} fill={color} stroke="#0d1b2a" strokeWidth={1} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke="#0d1b2a" strokeWidth={1} />;
}

function HistoryTooltip({ active, payload }: { active?: boolean; payload?: { payload: HistoryPoint }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div
      style={{
        backgroundColor: "rgba(13, 27, 42, 0.95)",
        border: "1px solid rgba(46,125,184,0.3)",
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 12,
        color: "#f0f4f8",
      }}
    >
      <div>{point.time}</div>
      <div>
        score {point.score.toFixed(1)} ·{" "}
        <span style={{ color: RISK_COLORS[point.level] }}>{LEVEL_LABELS[point.level]}</span>
      </div>
      {point.auto_critical && point.auto_critical_reason && (
        <div style={{ color: "#a8d4f0", marginTop: 2 }}>{point.auto_critical_reason}</div>
      )}
    </div>
  );
}

export function ScoreHistory({ history }: ScoreHistoryProps) {
  const data: HistoryPoint[] = history.map((h) => ({
    time: new Date(h.calculated_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    score: h.score,
    level: h.level,
    auto_critical: h.auto_critical,
    auto_critical_reason: h.auto_critical_reason,
  }));

  return (
    <div data-testid="score-history">
      <h3 className="mb-2 text-sm font-medium text-brand-blue-light/80">Histórico recente</h3>
      <div className="h-[70px] w-full md:h-20">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <ReferenceArea y1={1} y2={SCORE_THRESHOLDS.ATTENTION} fill={RISK_COLORS.normal} fillOpacity={0.08} />
            <ReferenceArea
              y1={SCORE_THRESHOLDS.ATTENTION}
              y2={SCORE_THRESHOLDS.MODERATE}
              fill={RISK_COLORS.attention}
              fillOpacity={0.08}
            />
            <ReferenceArea
              y1={SCORE_THRESHOLDS.MODERATE}
              y2={SCORE_THRESHOLDS.HIGH}
              fill={RISK_COLORS.moderate}
              fillOpacity={0.08}
            />
            <ReferenceArea
              y1={SCORE_THRESHOLDS.HIGH}
              y2={SCORE_THRESHOLDS.CRITICAL}
              fill={RISK_COLORS.high}
              fillOpacity={0.08}
            />
            <ReferenceArea y1={SCORE_THRESHOLDS.CRITICAL} y2={10} fill={RISK_COLORS.critical} fillOpacity={0.08} />
            {/* Sem eixo Y numérico visível -- as faixas coloridas já comunicam os limiares (domínio fixo
                mantido via `hide` pra não deixar a escala virar auto-range e desalinhar as faixas). */}
            <YAxis domain={[1, 10]} hide />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <Tooltip content={<HistoryTooltip />} />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#2e7db8"
              strokeWidth={2}
              dot={<HistoryDot />}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
