"use client";

import { useEffect, useState } from "react";
import type { ForecastResult } from "@/types";

export function useForecast(lat: number | null, lng: number | null) {
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lat === null || lng === null) {
      setForecast(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const res = await fetch(`/api/forecast?lat=${lat}&lng=${lng}`);
        if (!res.ok) throw new Error("forecast falhou");
        const data = await res.json();
        if (!cancelled) setForecast(data);
      } catch {
        if (!cancelled) setForecast(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return { forecast, loading };
}
