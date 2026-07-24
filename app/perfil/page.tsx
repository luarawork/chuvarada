"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { SuggestionModal } from "@/components/ui/SuggestionModal";
import type { ReportSeverity, ReportStatus, RiskLevel } from "@/types";

interface FavoriteNeighborhood {
  id: string;
  name: string;
  cityName: string;
  level: RiskLevel | null;
  score: number | null;
}

interface MyReport {
  id: string;
  severity: ReportSeverity;
  status: ReportStatus;
  confirmations: number;
  created_at: string;
  neighborhoodName: string;
  cityName: string;
}

const CARD_STYLE = { backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.2)" };

const SEVERITY_CONFIG: Record<ReportSeverity, { label: string; color: string }> = {
  leve: { label: "Leve", color: "#a8d4f0" },
  moderado: { label: "Moderado", color: "#f0a500" },
  grave: { label: "Grave", color: "#d64045" },
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  active: "Ativo",
  expired: "Expirado",
  resolved: "Resolvido",
  removed: "Removido",
};

export default function PerfilPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const signingOutRef = useRef(false);

  const [favorites, setFavorites] = useState<FavoriteNeighborhood[] | null>(null);
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [totalReports, setTotalReports] = useState(0);
  const [totalConfirmations, setTotalConfirmations] = useState(0);
  const [suggestionOpen, setSuggestionOpen] = useState(false);

  useEffect(() => {
    if (authLoading || signingOutRef.current) return;
    if (!user) {
      router.replace("/auth?next=/perfil&aviso=perfil");
      return;
    }

    async function load() {
      const [favoriteRes, reportsRes] = await Promise.all([
        supabase
          .from("user_favorites")
          .select("neighborhood_id, neighborhoods(name, cities(name))")
          .order("created_at", { ascending: false }),
        supabase
          .from("user_reports")
          .select("id, severity, status, confirmations, created_at, neighborhoods(name, cities(name))")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false }),
      ]);

      const favRows = favoriteRes.data ?? [];
      const favIds = favRows.map((r) => r.neighborhood_id);
      const { data: scoreRows } =
        favIds.length > 0
          ? await supabase.from("latest_risk_scores").select("neighborhood_id, level, score").in("neighborhood_id", favIds)
          : { data: [] };
      const scoreByNeighborhood = new Map((scoreRows ?? []).map((s) => [s.neighborhood_id, s]));

      setFavorites(
        favRows.map((r) => {
          const neighborhood = r.neighborhoods as unknown as { name: string; cities: { name: string } | null };
          const score = scoreByNeighborhood.get(r.neighborhood_id);
          return {
            id: r.neighborhood_id,
            name: neighborhood?.name ?? "Bairro",
            cityName: neighborhood?.cities?.name ?? "",
            level: (score?.level as RiskLevel) ?? null,
            score: score?.score ?? null,
          };
        })
      );

      const reportRows = reportsRes.data ?? [];
      setTotalReports(reportRows.length);
      setTotalConfirmations(reportRows.reduce((sum, r) => sum + (r.confirmations ?? 0), 0));
      setReports(
        reportRows.slice(0, 10).map((r) => {
          const neighborhood = r.neighborhoods as unknown as { name: string; cities: { name: string } | null };
          return {
            id: r.id,
            severity: r.severity,
            status: r.status,
            confirmations: r.confirmations,
            created_at: r.created_at,
            neighborhoodName: neighborhood?.name ?? "Bairro",
            cityName: neighborhood?.cities?.name ?? "",
          };
        })
      );
    }

    load();
  }, [user, authLoading, router]);

  async function handleRemoveFavorite(neighborhoodId: string) {
    if (!user) return;
    await supabase.from("user_favorites").delete().eq("user_id", user.id).eq("neighborhood_id", neighborhoodId);
    setFavorites((prev) => prev?.filter((f) => f.id !== neighborhoodId) ?? null);
  }

  async function handleResolveReport(reportId: string) {
    if (!user) return;
    const { error } = await supabase
      .from("user_reports")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", reportId)
      .eq("user_id", user.id);
    if (!error) {
      setReports((prev) => prev?.map((r) => (r.id === reportId ? { ...r, status: "resolved" as ReportStatus } : r)) ?? null);
    }
  }

  if (authLoading || !user) {
    return <div className="min-h-dvh" style={{ backgroundColor: "#0d1b2a" }} />;
  }

  const memberSince = new Date(user.created_at).toLocaleDateString("pt-BR", { year: "numeric", month: "long" });
  const initial = (user.email?.[0] ?? "?").toUpperCase();

  return (
    <div className="min-h-dvh" style={{ backgroundColor: "#0d1b2a", color: "#f0f4f8" }}>
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/" className="text-sm hover:underline" style={{ color: "#a8d4f0" }}>
          ← Voltar para o mapa
        </Link>

        {/* Header do perfil */}
        <div className="mt-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-heading text-xl font-bold"
              style={{ backgroundColor: "#2e7db8", color: "#f0f4f8" }}
            >
              {initial}
            </div>
            <div>
              <p className="font-heading text-lg font-bold">{user.email}</p>
              <p className="text-xs" style={{ color: "#a8d4f0" }}>
                Membro desde {memberSince}
              </p>
            </div>
          </div>
          <button
            onClick={async () => {
              signingOutRef.current = true;
              await signOut();
              router.push("/");
            }}
            className="shrink-0 text-sm opacity-60 hover:opacity-100 hover:underline"
          >
            Sair
          </button>
        </div>

        {/* Estatísticas */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border p-4 text-center backdrop-blur-sm" style={CARD_STYLE}>
            <p className="text-xl font-bold tabular-nums">{totalReports}</p>
            <p className="mt-0.5 text-xs" style={{ color: "#a8d4f0" }}>
              📍 relatos feitos
            </p>
          </div>
          <div className="rounded-2xl border p-4 text-center backdrop-blur-sm" style={CARD_STYLE}>
            <p className="text-xl font-bold tabular-nums">{totalConfirmations}</p>
            <p className="mt-0.5 text-xs" style={{ color: "#a8d4f0" }}>
              ✅ confirmações recebidas
            </p>
          </div>
          <div className="rounded-2xl border p-4 text-center backdrop-blur-sm" style={CARD_STYLE}>
            <p className="text-xl font-bold tabular-nums">{favorites?.length ?? 0}</p>
            <p className="mt-0.5 text-xs" style={{ color: "#a8d4f0" }}>
              ⭐ bairros salvos
            </p>
          </div>
        </div>

        {/* Bairros salvos */}
        <section className="mt-8">
          <h2 className="font-heading text-lg font-bold">Bairros salvos</h2>

          {favorites === null && (
            <p className="mt-3 text-sm" style={{ color: "#a8d4f0" }}>
              Carregando...
            </p>
          )}

          {favorites?.length === 0 && (
            <div className="mt-3 rounded-2xl border p-5 text-sm backdrop-blur-sm" style={{ ...CARD_STYLE, color: "#a8d4f0" }}>
              Você ainda não salvou nenhum bairro. Navegue pelo mapa e salve os que quer monitorar.
            </div>
          )}

          {favorites && favorites.length > 0 && (
            <ul className="mt-3 space-y-2">
              {favorites.map((fav) => (
                <li
                  key={fav.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border p-4 backdrop-blur-sm"
                  style={CARD_STYLE}
                >
                  <Link href={`/?bairro=${fav.id}`} className="min-w-0 flex-1">
                    <p className="truncate font-heading text-sm font-semibold">{fav.name}</p>
                    <p className="truncate text-xs" style={{ color: "#a8d4f0" }}>
                      {fav.cityName}
                    </p>
                  </Link>
                  {fav.level ? (
                    <RiskBadge level={fav.level} score={fav.score ?? undefined} />
                  ) : (
                    <span className="text-xs opacity-40">Sem dados</span>
                  )}
                  <button
                    onClick={() => handleRemoveFavorite(fav.id)}
                    aria-label="Remover dos favoritos"
                    className="shrink-0 rounded-full p-2 opacity-50 hover:bg-white/10 hover:opacity-100"
                  >
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Meus relatos */}
        <section className="mt-8">
          <h2 className="font-heading text-lg font-bold">Meus relatos</h2>

          {reports === null && (
            <p className="mt-3 text-sm" style={{ color: "#a8d4f0" }}>
              Carregando...
            </p>
          )}

          {reports?.length === 0 && (
            <div className="mt-3 rounded-2xl border p-5 text-sm backdrop-blur-sm" style={{ ...CARD_STYLE, color: "#a8d4f0" }}>
              Você ainda não fez nenhum relato. Use o botão de relato no mapa pra reportar um alagamento.
            </div>
          )}

          {reports && reports.length > 0 && (
            <ul className="mt-3 space-y-2">
              {reports.map((r) => (
                <li key={r.id} className="rounded-2xl border p-4 backdrop-blur-sm" style={CARD_STYLE}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: SEVERITY_CONFIG[r.severity].color }}
                      />
                      <span className="text-sm font-medium">{SEVERITY_CONFIG[r.severity].label}</span>
                      <span className="text-xs opacity-60">
                        {r.neighborhoodName} — {r.cityName}
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: "#a8d4f0" }}>
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs" style={{ color: "#a8d4f0" }}>
                      {STATUS_LABEL[r.status]} · ✓ {r.confirmations} confirmações
                    </span>
                    {r.status === "active" && (
                      <button
                        onClick={() => handleResolveReport(r.id)}
                        className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-white/10"
                        style={{ borderColor: "rgba(240, 244, 248, 0.25)" }}
                      >
                        Marcar como resolvido
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Preferências de notificação */}
        <section className="mt-8">
          <h2 className="font-heading text-lg font-bold">Preferências de notificação</h2>
          <div className="mt-3 space-y-2 rounded-2xl border p-4 backdrop-blur-sm" style={CARD_STYLE}>
            <label
              className="flex cursor-not-allowed items-center justify-between gap-3 py-1.5 text-sm opacity-50"
              title="Em breve — notificações push em desenvolvimento"
            >
              Notificar quando risco aumentar nos meus bairros salvos
              <input type="checkbox" disabled className="h-4 w-4" />
            </label>
            <label
              className="flex cursor-not-allowed items-center justify-between gap-3 py-1.5 text-sm opacity-50"
              title="Em breve — notificações push em desenvolvimento"
            >
              Notificar quando meu relato for confirmado
              <input type="checkbox" disabled className="h-4 w-4" />
            </label>
          </div>
        </section>

        {/* Sugestão */}
        <section className="mt-8 mb-10">
          <div
            className="flex items-center justify-between gap-4 rounded-2xl border p-5 backdrop-blur-sm"
            style={CARD_STYLE}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">💡</span>
              <div>
                <p className="font-heading text-sm font-semibold">Tem uma sugestão para o Chuvarada?</p>
                <p className="text-xs" style={{ color: "#a8d4f0" }}>
                  Ajude a melhorar o produto
                </p>
              </div>
            </div>
            <button
              onClick={() => setSuggestionOpen(true)}
              className="shrink-0 rounded-full bg-brand-blue-mid px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-deep"
            >
              Enviar sugestão
            </button>
          </div>
        </section>
      </div>

      {suggestionOpen && <SuggestionModal onClose={() => setSuggestionOpen(false)} />}
    </div>
  );
}
