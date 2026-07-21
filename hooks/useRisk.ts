"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RiskScore } from "@/types";

// Busca o score atual e o histórico de 6h de um bairro selecionado, e
// assina atualizações em tempo real para ESSE bairro específico — sem
// isso, o painel aberto ficava com o score/histórico congelados no
// instante em que foi aberto, mesmo que o cron gravasse um score novo
// minutos depois (achado do relatório de testes pré-deploy: só as cores
// do mapa atualizavam sozinhas via hooks/useRealtime.ts, que alimenta só
// `levelsById` em app/page.tsx — o painel de detalhe não tinha nenhuma
// assinatura própria). `justUpdated` fica `true` por 3s após uma
// atualização via Realtime, pra acionar um selo "Atualizado agora".
export function useRisk(neighborhoodId: string | null) {
  const [current, setCurrent] = useState<RiskScore | null>(null);
  const [history, setHistory] = useState<RiskScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);

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

    let updateTimeout: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`risk_scores_panel_${neighborhoodId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "risk_scores",
          filter: `neighborhood_id=eq.${neighborhoodId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as RiskScore;
          setHistory((prev) => [...prev, row]);
          setCurrent(row);
          setJustUpdated(true);
          clearTimeout(updateTimeout);
          updateTimeout = setTimeout(() => setJustUpdated(false), 3000);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearTimeout(updateTimeout);
      supabase.removeChannel(channel);
    };
  }, [neighborhoodId]);

  return { current, history, loading, justUpdated };
}
