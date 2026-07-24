"use client";

import { motion } from "framer-motion";

interface VariableCardProps {
  emoji: string;
  title: string;
  weight: number;
  description: string;
}

export function VariableCard({ emoji, title, weight, description }: VariableCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border p-5 backdrop-blur-sm"
      style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.2)" }}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xl">{emoji}</span>
        <h3 className="font-heading text-base font-semibold" style={{ color: "#f0f4f8" }}>
          {title}
        </h3>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "rgba(240, 244, 248, 0.1)" }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${weight * 100}%` }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="h-full rounded-full"
            style={{ backgroundColor: "#2e7db8" }}
          />
        </div>
        <span className="shrink-0 text-xs font-medium tabular-nums" style={{ color: "#2e7db8" }}>
          {(weight * 100).toFixed(0)}%
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed" style={{ color: "#a8d4f0" }}>
        {description}
      </p>
    </motion.div>
  );
}
