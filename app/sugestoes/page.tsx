"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Página interna de acompanhamento de sugestões (ver Item 7 do pedido) --
// sem link no menu, acesso só por URL direta. Usa /api/suggestions/all e
// /api/suggestions/[id] (client admin, service_role -- ver
// lib/supabaseAdmin.ts), já que a RLS normal só deixa cada usuário ler as
// próprias sugestões.

type SuggestionType = "bug" | "feature" | "data" | "coverage" | "other";
type SuggestionStatus = "open" | "in_review" | "resolved";

interface Suggestion {
  id: string;
  type: SuggestionType;
  description: string;
  contact_email: string | null;
  status: SuggestionStatus;
  created_at: string;
}

const TYPE_INFO: Record<SuggestionType, { label: string; icon: string; color: string }> = {
  bug: { label: "Bug", icon: "🐛", color: "#d64045" },
  feature: { label: "Funcionalidade", icon: "💡", color: "#f0a500" },
  data: { label: "Dados", icon: "📊", color: "#2e7db8" },
  coverage: { label: "Cobertura", icon: "🗺️", color: "#a8d4f0" },
  other: { label: "Outro", icon: "💬", color: "#a8d4f0" },
};

const STATUS_INFO: Record<SuggestionStatus, { label: string; color: string }> = {
  open: { label: "Aberta", color: "#a8d4f0" },
  in_review: { label: "Em análise", color: "#f0a500" },
  resolved: { label: "Resolvida", color: "#2a9d72" },
};

const TYPE_FILTER_OPTIONS: { value: SuggestionType | "todos"; label: string }[] = [
  { value: "todos", label: "Todos os tipos" },
  { value: "bug", label: "🐛 Bug" },
  { value: "feature", label: "💡 Funcionalidade" },
  { value: "data", label: "📊 Dados" },
  { value: "coverage", label: "🗺️ Cobertura" },
  { value: "other", label: "💬 Outro" },
];

const STATUS_FILTER_OPTIONS: { value: SuggestionStatus | "todos"; label: string }[] = [
  { value: "todos", label: "Todos os status" },
  { value: "open", label: "Aberta" },
  { value: "in_review", label: "Em análise" },
  { value: "resolved", label: "Resolvida" },
];

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

export default function SugestoesPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<SuggestionType | "todos">("todos");
  const [statusFilter, setStatusFilter] = useState<SuggestionStatus | "todos">("todos");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/suggestions/all");
      if (!res.ok) throw new Error("Falha ao buscar sugestões");
      const { data } = (await res.json()) as { data: Suggestion[] };
      setSuggestions(data);
    } catch {
      setError("Falha ao buscar sugestões.");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, status: SuggestionStatus) {
    const previous = suggestions;
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    try {
      const res = await fetch(`/api/suggestions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setSuggestions(previous);
      setError("Falha ao atualizar status.");
    }
  }

  async function remove(id: string) {
    if (!confirm("Remover esta sugestão? Essa ação não pode ser desfeita.")) return;
    const previous = suggestions;
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    try {
      const res = await fetch(`/api/suggestions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setSuggestions(previous);
      setError("Falha ao remover sugestão.");
    }
  }

  const filtered = suggestions.filter(
    (s) => (typeFilter === "todos" || s.type === typeFilter) && (statusFilter === "todos" || s.status === statusFilter)
  );

  const counts = {
    total: suggestions.length,
    open: suggestions.filter((s) => s.status === "open").length,
    in_review: suggestions.filter((s) => s.status === "in_review").length,
    resolved: suggestions.filter((s) => s.status === "resolved").length,
  };

  return (
    <div className="min-h-dvh" style={{ backgroundColor: "#0d1b2a" }}>
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/" className="text-sm hover:underline" style={{ color: "#a8d4f0" }}>
          ← Voltar para o mapa
        </Link>

        <h1 className="mt-4 font-heading text-2xl font-bold md:text-3xl" style={{ color: "#f0f4f8" }}>
          Sugestões dos usuários
        </h1>
        <p className="mt-1 text-sm" style={{ color: "#a8d4f0" }}>
          Página interna — não indexada.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: "rgba(240, 244, 248, 0.06)" }}>
            <div className="font-heading text-lg font-bold tabular-nums" style={{ color: "#f0f4f8" }}>
              {counts.total}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: "#a8d4f0" }}>
              Total
            </div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: "rgba(240, 244, 248, 0.06)" }}>
            <div className="font-heading text-lg font-bold tabular-nums" style={{ color: STATUS_INFO.open.color }}>
              {counts.open}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: "#a8d4f0" }}>
              Abertas
            </div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: "rgba(240, 244, 248, 0.06)" }}>
            <div className="font-heading text-lg font-bold tabular-nums" style={{ color: STATUS_INFO.in_review.color }}>
              {counts.in_review}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: "#a8d4f0" }}>
              Em análise
            </div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: "rgba(240, 244, 248, 0.06)" }}>
            <div className="font-heading text-lg font-bold tabular-nums" style={{ color: STATUS_INFO.resolved.color }}>
              {counts.resolved}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: "#a8d4f0" }}>
              Resolvidas
            </div>
          </div>
        </div>

        <div
          className="mt-6 flex flex-wrap items-end gap-4 rounded-2xl border p-5"
          style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
        >
          <label className="flex flex-col gap-1 text-xs" style={{ color: "#a8d4f0" }}>
            Tipo
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as SuggestionType | "todos")}
              className="rounded-lg border-none bg-white/10 px-3 py-2 text-sm"
              style={{ color: "#f0f4f8" }}
            >
              {TYPE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ color: "#1a3a5c" }}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "#a8d4f0" }}>
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as SuggestionStatus | "todos")}
              className="rounded-lg border-none bg-white/10 px-3 py-2 text-sm"
              style={{ color: "#f0f4f8" }}
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ color: "#1a3a5c" }}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: "#2e7db8", color: "#f0f4f8" }}
          >
            {loading ? "Buscando..." : "Atualizar"}
          </button>
        </div>

        {error && (
          <p className="mt-4 text-sm" style={{ color: "#d64045" }}>
            {error}
          </p>
        )}

        <div className="mt-6 space-y-3">
          {!loading && filtered.length === 0 && (
            <p className="text-sm" style={{ color: "#a8d4f0" }}>
              Nenhuma sugestão encontrada com esses filtros.
            </p>
          )}

          {filtered.map((s) => (
            <div
              key={s.id}
              className="rounded-2xl border p-4"
              style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: `${TYPE_INFO[s.type].color}26`, color: TYPE_INFO[s.type].color }}
                >
                  {TYPE_INFO[s.type].icon} {TYPE_INFO[s.type].label}
                </span>

                <span
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: `${STATUS_INFO[s.status].color}26`, color: STATUS_INFO[s.status].color }}
                >
                  {STATUS_INFO[s.status].label}
                </span>
                <select
                  value={s.status}
                  onChange={(e) => updateStatus(s.id, e.target.value as SuggestionStatus)}
                  className="rounded-lg border-none bg-white/10 px-2 py-1 text-xs"
                  style={{ color: "#f0f4f8" }}
                >
                  {(["open", "in_review", "resolved"] as SuggestionStatus[]).map((st) => (
                    <option key={st} value={st} style={{ color: "#1a3a5c" }}>
                      {STATUS_INFO[st].label}
                    </option>
                  ))}
                </select>

                <span className="ml-auto text-xs" style={{ color: "#a8d4f0" }}>
                  {relativeTime(s.created_at)}
                </span>
              </div>

              <p className="mt-2 text-sm" style={{ color: "#f0f4f8" }}>
                {s.description}
              </p>

              {s.contact_email && (
                <p className="mt-1 text-xs" style={{ color: "#a8d4f0" }}>
                  Contato: {s.contact_email}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => updateStatus(s.id, "in_review")}
                  disabled={s.status === "in_review"}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                  style={{ borderColor: "rgba(240, 244, 248, 0.2)", color: "#f0f4f8" }}
                >
                  Em análise
                </button>
                <button
                  onClick={() => updateStatus(s.id, "resolved")}
                  disabled={s.status === "resolved"}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                  style={{ borderColor: "rgba(240, 244, 248, 0.2)", color: "#f0f4f8" }}
                >
                  Resolvida
                </button>
                <button
                  onClick={() => remove(s.id)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium"
                  style={{ borderColor: "rgba(214, 64, 69, 0.4)", color: "#d64045" }}
                >
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
