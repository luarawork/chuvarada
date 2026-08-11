"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/ui/RiskBadge";
import type { RiskLevel } from "@/types";

interface FavoriteNeighborhood {
  id: string;
  name: string;
  cityName: string;
  level: RiskLevel | null;
  score: number | null;
}

// Mesmo padrão visual de app/perfil/page.tsx -- essa página usava tema claro
// (bg-brand-gray-light + cards brancos) enquanto todo o resto do app (mapa,
// /auth, /perfil, /como-funciona) é escuro; destoava.
const CARD_STYLE = { backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.2)" };

const LEVEL_ORDER: Record<RiskLevel | "sem_dado", number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  attention: 3,
  normal: 4,
  sem_dado: 5,
};

export default function FavoritosPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const [favorites, setFavorites] = useState<FavoriteNeighborhood[] | null>(null);
  const signingOutRef = useRef(false);

  useEffect(() => {
    if (authLoading || signingOutRef.current) return;
    if (!user) {
      router.replace("/auth?next=/favoritos&aviso=favoritos");
      return;
    }

    async function load() {
      const { data: favoriteRows } = await supabase
        .from("user_favorites")
        .select("neighborhood_id, neighborhoods(name, cities(name))")
        .order("created_at", { ascending: false });

      const rows = favoriteRows ?? [];
      const ids = rows.map((r) => r.neighborhood_id);

      const { data: scoreRows } =
        ids.length > 0
          ? await supabase.from("latest_risk_scores").select("neighborhood_id, level, score").in("neighborhood_id", ids)
          : { data: [] };

      const scoreByNeighborhood = new Map((scoreRows ?? []).map((s) => [s.neighborhood_id, s]));

      const result: FavoriteNeighborhood[] = rows.map((r) => {
        const neighborhood = r.neighborhoods as unknown as { name: string; cities: { name: string } | null };
        const score = scoreByNeighborhood.get(r.neighborhood_id);
        return {
          id: r.neighborhood_id,
          name: neighborhood?.name ?? "Bairro",
          cityName: neighborhood?.cities?.name ?? "",
          level: (score?.level as RiskLevel) ?? null,
          score: score?.score ?? null,
        };
      });

      result.sort((a, b) => LEVEL_ORDER[a.level ?? "sem_dado"] - LEVEL_ORDER[b.level ?? "sem_dado"]);
      setFavorites(result);
    }

    load();
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return <div className="min-h-dvh" style={{ backgroundColor: "#0d1b2a" }} />;
  }

  return (
    <div className="min-h-dvh" style={{ backgroundColor: "#0d1b2a", color: "#f0f4f8" }}>
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" size="sm" className="h-auto px-0 text-sm font-normal hover:bg-transparent hover:underline" style={{ color: "#a8d4f0" }}>
            <Link href="/">← Voltar para o mapa</Link>
          </Button>
          <button
            onClick={async () => {
              // Marca a saída como intencional pra o guard (acima) não
              // correr na frente e mandar pro /auth em vez do mapa quando
              // `user` virar null.
              signingOutRef.current = true;
              await signOut();
              router.push("/");
            }}
            className="text-sm opacity-60 hover:opacity-100 hover:underline"
          >
            Sair
          </button>
        </div>

        <h1 className="mt-4 font-heading text-2xl font-bold md:text-3xl">Seus bairros salvos</h1>

        {favorites === null && (
          <p className="mt-8 text-sm" style={{ color: "#a8d4f0" }}>
            Carregando...
          </p>
        )}

        {favorites?.length === 0 && (
          <div className="mt-8 rounded-2xl border p-6 text-sm backdrop-blur-sm" style={{ ...CARD_STYLE, color: "#a8d4f0" }}>
            Você ainda não salvou nenhum bairro. Navegue pelo mapa e salve os que quer monitorar.
          </div>
        )}

        {favorites && favorites.length > 0 && (
          <ul className="mt-6 space-y-3">
            {favorites.map((fav) => (
              <li key={fav.id}>
                <Link
                  href={`/?bairro=${fav.id}`}
                  className="flex items-center justify-between rounded-2xl border p-5 backdrop-blur-sm transition hover:bg-white/5"
                  style={CARD_STYLE}
                >
                  <div>
                    <p className="font-heading font-semibold">{fav.name}</p>
                    <p className="text-sm" style={{ color: "#a8d4f0" }}>
                      {fav.cityName}
                    </p>
                  </div>
                  {fav.level ? (
                    <RiskBadge level={fav.level} score={fav.score ?? undefined} />
                  ) : (
                    <span className="text-xs opacity-40">Sem dados ainda</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
