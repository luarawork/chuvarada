"use client";

import { useEffect, useState } from "react";
import type { RiskLevel } from "@/types";

export interface RiskForecastDay {
  date: string;
  score: number;
  level: RiskLevel;
  auto_critical: boolean;
  rain_peak_3h: number;
  rain_72h: number;
  confidence: number;
}

interface RiskForecastResponse {
  forecast: RiskForecastDay[];
}

// Diferente de useForecast.ts (previsão do TEMPO, atual+12h, carregada
// sempre que o painel abre): esta é a previsão de RISCO de 7 dias, só
// buscada quando o usuário clica em "Previsão →" (`enabled`) -- a maioria
// dos cliques em bairro nunca chega a abrir essa seção, e a chamada ao
// Open-Meteo compartilha a mesma cota diária do cron (ver
// lib/riskForecast.ts / lib/weather.ts).
export function useRiskForecast(neighborhoodId: string | null, enabled: boolean) {
  const [forecast, setForecast] = useState<RiskForecastDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !neighborhoodId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const res = await fetch(`/api/forecast/${neighborhoodId}`);
        if (!res.ok) throw new Error("previsão de risco falhou");
        const data: RiskForecastResponse = await res.json();
        if (!cancelled) setForecast(data.forecast);
      } catch {
        if (!cancelled) setError("Não foi possível carregar a previsão.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [neighborhoodId, enabled]);

  return { forecast, loading, error };
}
