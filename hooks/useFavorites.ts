"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";

interface UseFavoritesResult {
  favoriteIds: Set<string>;
  orderedIds: string[]; // mais recente primeiro
  isFavorite: (neighborhoodId: string) => boolean;
  toggleFavorite: (neighborhoodId: string) => Promise<void>;
  loading: boolean;
}

// IDs dos bairros favoritados pelo usuário logado. Usado tanto pelo coração
// no painel de bairro quanto pra decidir onde o app abre (bairro favorito
// mais recente). A tabela já tem RLS por auth.uid(), então as queries aqui
// não precisam (nem devem) filtrar por user_id manualmente.
export function useFavorites(): UseFavoritesResult {
  const { user } = useAuth();
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) {
      setOrderedIds([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("user_favorites")
      .select("neighborhood_id")
      .order("created_at", { ascending: false });
    setOrderedIds((data ?? []).map((row) => row.neighborhood_id));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  const favoriteIds = new Set(orderedIds);

  const isFavorite = useCallback((neighborhoodId: string) => favoriteIds.has(neighborhoodId), [favoriteIds]);

  const toggleFavorite = useCallback(
    async (neighborhoodId: string) => {
      if (!user) return;
      if (favoriteIds.has(neighborhoodId)) {
        await supabase
          .from("user_favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("neighborhood_id", neighborhoodId);
        setOrderedIds((prev) => prev.filter((id) => id !== neighborhoodId));
      } else {
        await supabase.from("user_favorites").insert({ user_id: user.id, neighborhood_id: neighborhoodId });
        setOrderedIds((prev) => [neighborhoodId, ...prev]);
      }
    },
    [user, favoriteIds]
  );

  return { favoriteIds, orderedIds, isFavorite, toggleFavorite, loading };
}
