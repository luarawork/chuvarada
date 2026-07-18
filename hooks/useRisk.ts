"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RiskScore } from "@/types";

// Busca o score atual e o histórico de 6h de um bairro selecionado.
export function useRisk(neighborhoodId: string | null) {
  const [current, setCurrent] = useState<RiskScore | null>(null);
  const [history, setHistory] = useState<RiskScore[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!neighborhoodId) {
      setCurrent(null);
      setHistory([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();

      const { data } = await supabase
        .from("risk_scores")
        .select("*")
        .eq("neighborhood_id", neighborhoodId)
        .gte("calculated_at", sixHoursAgo)
        .order("calculated_at", { ascending: true });

      if (cancelled) return;

      const rows = (data as RiskScore[]) ?? [];
      setHistory(rows);
      setCurrent(rows.length > 0 ? rows[rows.length - 1] : null);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [neighborhoodId]);

  return { current, history, loading };
}
