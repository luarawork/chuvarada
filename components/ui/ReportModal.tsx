"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ReportSeverity } from "@/types";

interface ReportModalProps {
  onClose: () => void;
  onSubmit: (severity: ReportSeverity, description: string) => Promise<void>;
}

const SEVERITY_OPTIONS: { value: ReportSeverity; label: string; color: string }[] = [
  { value: "leve", label: "Leve", color: "#a8d4f0" },
  { value: "moderado", label: "Moderado", color: "#f0a500" },
  { value: "grave", label: "Grave", color: "#d64045" },
];

const MAX_DESCRIPTION_LENGTH = 280;

export function ReportModal({ onClose, onSubmit }: ReportModalProps) {
  const [severity, setSeverity] = useState<ReportSeverity>("moderado");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(severity, description.trim());
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[1400] flex items-end justify-center bg-black/50 backdrop-blur-[2px] md:items-center"
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-t-3xl border px-6 py-6 shadow-2xl md:rounded-3xl"
          style={{
            backgroundColor: "rgba(13, 27, 42, 0.96)",
            borderColor: "rgba(46, 125, 184, 0.3)",
            color: "#f0f4f8",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-heading text-base font-bold">Relatar situação</h3>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="shrink-0 rounded-full p-1.5 opacity-60 hover:bg-white/10 hover:opacity-100"
            >
              ✕
            </button>
          </div>

          <p className="mt-1 text-xs" style={{ color: "#a8d4f0" }}>
            Qual a gravidade no local marcado?
          </p>

          <div className="mt-3 flex gap-2">
            {SEVERITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setSeverity(option.value)}
                className="flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition"
                style={{
                  borderColor: severity === option.value ? option.color : "rgba(240, 244, 248, 0.2)",
                  backgroundColor: severity === option.value ? `${option.color}26` : "transparent",
                  color: severity === option.value ? option.color : "#f0f4f8",
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
            placeholder="Descreva o que está acontecendo (opcional)"
            rows={3}
            className="mt-3 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm placeholder:opacity-50 focus:outline-none"
            style={{ borderColor: "rgba(240, 244, 248, 0.2)" }}
          />
          <div className="mt-1 text-right text-xs opacity-50">
            {description.length}/{MAX_DESCRIPTION_LENGTH}
          </div>

          {error && <p className="mt-2 text-xs text-brand-red-alert">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-3 w-full rounded-xl bg-brand-blue-mid py-2.5 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:opacity-50"
          >
            {submitting ? "Enviando..." : "Enviar relato"}
          </button>

          <p className="mt-3 text-center text-[11px] opacity-50">
            Relatos expiram automaticamente. Entre numa conta para que seus relatos tenham mais peso.
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
