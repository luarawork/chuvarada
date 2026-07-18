"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceArea,
  Tooltip,
} from "recharts";
import type { RiskScore } from "@/types";

interface HistoryChartProps {
  history: RiskScore[];
}

export function HistoryChart({ history }: HistoryChartProps) {
  const data = history.map((h) => ({
    time: new Date(h.calculated_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    score: h.score,
  }));

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <ReferenceArea y1={0} y2={0.4} fill="#2a9d72" fillOpacity={0.08} />
          <ReferenceArea y1={0.4} y2={0.7} fill="#f0a500" fillOpacity={0.08} />
          <ReferenceArea y1={0.7} y2={1} fill="#d64045" fillOpacity={0.08} />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(value) => (typeof value === "number" ? value.toFixed(2) : value)}
            labelStyle={{ fontSize: 12 }}
          />
          <Line type="monotone" dataKey="score" stroke="#2e7db8" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
