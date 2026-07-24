"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

interface SuggestionModalProps {
  onClose: () => void;
}

const TYPE_OPTIONS = [
  { value: "bug", label: "🐛 Reportar um bug" },
  { value: "feature", label: "💡 Sugestão de funcionalidade" },
  { value: "data", label: "📊 Problema com os dados" },
  { value: "coverage", label: "🗺️ Cobertura — minha cidade não está no mapa" },
  { value: "other", label: "💬 Outro" },
];

const MAX_DESCRIPTION_LENGTH = 1000;

export function SuggestionModal({ onClose }: SuggestionModalProps) {
  const { user } = useAuth();
  const [type, setType] = useState(TYPE_OPTIONS[0].value);
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!description.trim()) {
      setError("Descreva sua sugestão antes de enviar.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ type, description: description.trim(), contact_email: email || undefined }),
      });

      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Falha ao enviar sugestão" }));
        throw new Error(msg);
      }

      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
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
            <h3 className="font-heading text-base font-bold">Enviar sugestão</h3>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="shrink-0 rounded-full p-1.5 opacity-60 hover:bg-white/10 hover:opacity-100"
            >
              ✕
            </button>
          </div>

          {sent ? (
            <p className="mt-6 text-sm" style={{ color: "#a8d4f0" }}>
              Sugestão enviada — obrigado por ajudar a melhorar o Chuvarada!
            </p>
          ) : (
            <>
              <label className="mt-4 block text-xs" style={{ color: "#a8d4f0" }}>
                Tipo de sugestão
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="mt-1 w-full rounded-lg border-none bg-white/10 px-3 py-2 text-sm"
                  style={{ color: "#f0f4f8" }}
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} style={{ color: "#1a3a5c" }}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-3 block text-xs" style={{ color: "#a8d4f0" }}>
                Descrição
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
                  placeholder="Descreva sua sugestão com o máximo de detalhes..."
                  rows={4}
                  className="mt-1 w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm placeholder:opacity-50 focus:outline-none"
                  style={{ borderColor: "rgba(240, 244, 248, 0.2)", color: "#f0f4f8" }}
                />
              </label>
              <div className="text-right text-xs opacity-50">
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </div>

              <label className="mt-1 block text-xs" style={{ color: "#a8d4f0" }}>
                Email para contato (opcional)
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@email.com"
                  className="mt-1 w-full rounded-lg border-none bg-white/10 px-3 py-2 text-sm placeholder:opacity-50"
                  style={{ color: "#f0f4f8" }}
                />
              </label>

              {error && <p className="mt-2 text-xs text-brand-red-alert">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="mt-4 w-full rounded-xl bg-brand-blue-mid py-2.5 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:opacity-50"
              >
                {submitting ? "Enviando..." : "Enviar"}
              </button>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
