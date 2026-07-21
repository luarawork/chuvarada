"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RiskScore } from "@/types";

// Acima disso não usa o filtro `neighborhood_id=in.(...)` do Realtime --
// a string do filtro tem um teto prático de tamanho, e uma lista muito
// grande (viewport bem aberto, perto do truncamento de
// MAX_NEIGHBORHOODS_PER_REQUEST em /api/neighborhoods) arriscaria estourar
// isso e quebrar a subscription inteira. Nesse caso cai pro filtro
// client-side de antes (recebe todo INSERT nacional e descarta os que não
// interessam) -- pior em volume de rede, mas nunca quebra.
const MAX_IDS_FOR_SERVER_FILTER = 500;

// Assina inserts na tabela risk_scores e devolve o último score recebido por
// bairro. O consumidor usa isso para atualizar apenas os polígonos afetados
// no mapa.
//
// Com carregamento por viewport, neighborhoodIds agora é tipicamente
// dezenas/poucas centenas (não mais os ~24.556 bairros do Brasil inteiro),
// então dá pra filtrar no servidor (Realtime só manda pro cliente os
// eventos que já interessam) em vez de receber todo INSERT nacional a cada
// ciclo de cron e descartar client-side.
export function useRealtime(neighborhoodIds: string[]) {
  const [latestByNeighborhood, setLatestByNeighborhood] = useState<Record<string, RiskScore>>({});

  useEffect(() => {
    if (neighborhoodIds.length === 0) return;

    const useServerFilter = neighborhoodIds.length <= MAX_IDS_FOR_SERVER_FILTER;
    const channel = supabase
      .channel(`risk_scores_updates_${useServerFilter ? neighborhoodIds.join(",") : "all"}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "risk_scores",
          ...(useServerFilter ? { filter: `neighborhood_id=in.(${neighborhoodIds.join(",")})` } : {}),
        },
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
