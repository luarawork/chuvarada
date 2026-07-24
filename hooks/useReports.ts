"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MapBounds } from "./useMap";
import type { UserReport } from "@/types";

function isWithinBounds(report: UserReport, bounds: MapBounds): boolean {
  return (
    report.lat >= bounds.south &&
    report.lat <= bounds.north &&
    report.lng >= bounds.west &&
    report.lng <= bounds.east
  );
}

async function fetchReportsForBounds(bounds: MapBounds): Promise<UserReport[]> {
  const params = new URLSearchParams({
    north: bounds.north.toString(),
    south: bounds.south.toString(),
    east: bounds.east.toString(),
    west: bounds.west.toString(),
  });
  const res = await fetch(`/api/reports?${params}`);
  if (!res.ok) throw new Error(`Falha ao buscar relatos do viewport: ${res.status}`);
  const { reports } = await res.json();
  return reports as UserReport[];
}

// Relatos ativos do viewport atual -- mesmo padrão de debounce+cancelamento
// de fetchNeighborhoodsForBounds (app/page.tsx), mais uma subscription
// Realtime pra INSERT/UPDATE em user_reports. Diferente de useRealtime.ts
// (que filtra por uma lista pré-conhecida de neighborhoodIds no servidor),
// aqui não existe uma lista de ids -- um relato novo pode aparecer em
// qualquer ponto do Brasil, então a subscription recebe todo evento
// nacional e filtra client-side comparando lat/lng com o bounds atual (via
// ref, pra não recriar o channel a cada pan do mapa).
export function useReports(bounds: MapBounds | null) {
  const [reports, setReports] = useState<UserReport[]>([]);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  useEffect(() => {
    if (!bounds) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const data = await fetchReportsForBounds(bounds);
        if (cancelled) return;
        setReports(data);
      } catch (err) {
        console.error("Erro ao buscar relatos do viewport:", err);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bounds]);

  useEffect(() => {
    const channel = supabase
      .channel("user_reports_updates")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "user_reports" },
        (payload) => {
          const row = payload.new as UserReport;
          if (row.status !== "active") return;
          if (!boundsRef.current || !isWithinBounds(row, boundsRef.current)) return;
          setReports((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "user_reports" },
        (payload) => {
          const row = payload.new as UserReport;
          setReports((prev) => {
            const withinBounds = boundsRef.current ? isWithinBounds(row, boundsRef.current) : false;
            if (row.status !== "active" || !withinBounds) {
              return prev.filter((r) => r.id !== row.id);
            }
            const exists = prev.some((r) => r.id === row.id);
            return exists ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return reports;
}
