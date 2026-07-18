"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RiskScore } from "@/types";

// Assina inserts na tabela risk_scores e devolve o último score recebido por bairro.
// O consumidor usa isso para atualizar apenas os polígonos afetados no mapa.
export function useRealtime(neighborhoodIds: string[]) {
  const [latestByNeighborhood, setLatestByNeighborhood] = useState<Record<string, RiskScore>>({});

  useEffect(() => {
    if (neighborhoodIds.length === 0) return;

    const channel = supabase
      .channel("risk_scores_updates")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "risk_scores" },
        (payload) => {
          const row = payload.new as RiskScore;
          if (!neighborhoodIds.includes(row.neighborhood_id)) return;
          setLatestByNeighborhood((prev) => ({ ...prev, [row.neighborhood_id]: row }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [neighborhoodIds]);

  return latestByNeighborhood;
}
