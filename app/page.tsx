"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { MapContainer } from "@/components/map/MapContainer";
import { NeighborhoodLayer } from "@/components/map/NeighborhoodLayer";
import { LocationButton } from "@/components/map/LocationButton";
import { EmptyStateLayer } from "@/components/map/EmptyStateLayer";
import { LoadingMap } from "@/components/ui/LoadingMap";
import { CityHeader } from "@/components/ui/CityHeader";
import { AlertCard } from "@/components/ui/AlertCard";
import { ProfileButton } from "@/components/ui/ProfileButton";
import { DetailPanel } from "@/components/panel/DetailPanel";
import { useMap } from "@/hooks/useMap";
import { useLocation } from "@/hooks/useLocation";
import { useRealtime } from "@/hooks/useRealtime";
import { useRisk } from "@/hooks/useRisk";
import { supabase } from "@/lib/supabase";
import { findNeighborhoodAtPoint } from "@/lib/geojson";
import type { City, Neighborhood, RiskLevel, RiskScore } from "@/types";

export default function HomePage() {
  const { map, handleMapReady, flyTo } = useMap();
  const location = useLocation();

  const [cities, setCities] = useState<City[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [latestScores, setLatestScores] = useState<Record<string, RiskScore>>({});
  const [selected, setSelected] = useState<Neighborhood | null>(null);
  const [showLocationBanner, setShowLocationBanner] = useState(false);
  const [loading, setLoading] = useState(true);

  const neighborhoodIds = useMemo(() => neighborhoods.map((n) => n.id), [neighborhoods]);
  const realtimeUpdates = useRealtime(neighborhoodIds);
  const { current: selectedCurrent, history: selectedHistory } = useRisk(selected?.id ?? null);

  useEffect(() => {
    async function load() {
      const [{ data: citiesData }, { data: neighborhoodsData }] = await Promise.all([
        supabase.from("cities").select("*").eq("active", true),
        supabase.from("neighborhoods").select("*"),
      ]);
      setCities((citiesData as City[]) ?? []);
      setNeighborhoods((neighborhoodsData as Neighborhood[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowLocationBanner(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    setLatestScores((prev) => ({ ...prev, ...realtimeUpdates }));
  }, [realtimeUpdates]);

  useEffect(() => {
    async function loadLatestScores() {
      if (neighborhoodIds.length === 0) return;
      // Usa a view latest_risk_scores (1 linha por bairro) em vez de um
      // .in("neighborhood_id", [...706 ids]) — essa lista gera uma URL
      // grande demais pro PostgREST e falhava silenciosamente.
      const { data, error } = await supabase.from("latest_risk_scores").select("*");
      if (error) {
        console.error("Erro ao buscar latest_risk_scores:", error);
        return;
      }

      const byNeighborhood: Record<string, RiskScore> = {};
      for (const row of (data as RiskScore[]) ?? []) {
        byNeighborhood[row.neighborhood_id] = row;
      }
      setLatestScores(byNeighborhood);
    }
    loadLatestScores();
  }, [neighborhoodIds]);

  const levelsById = useMemo(() => {
    const map: Record<string, RiskLevel> = {};
    for (const [id, score] of Object.entries(latestScores)) map[id] = score.level;
    return map;
  }, [latestScores]);

  function handleLocationRequest() {
    setShowLocationBanner(false);
    location.requestLocation();
  }

  useEffect(() => {
    if (location.status !== "granted" || location.lat === null || location.lng === null) return;
    flyTo(location.lat, location.lng, 14);
    const nearby = findNeighborhoodAtPoint(neighborhoods, location.lat, location.lng);
    if (nearby) setSelected(nearby);
  }, [location.status, location.lat, location.lng, neighborhoods, flyTo]);

  const selectedCity = selected ? cities.find((c) => c.id === selected.city_id) : null;

  const overallLevel: RiskLevel = useMemo(() => {
    const levels = Object.values(levelsById);
    if (levels.includes("critical")) return "critical";
    if (levels.includes("attention")) return "attention";
    return "normal";
  }, [levelsById]);

  const mostRecentUpdate = useMemo(() => {
    const dates = Object.values(latestScores).map((s) => s.calculated_at);
    if (dates.length === 0) return null;
    return dates.sort().reverse()[0];
  }, [latestScores]);

  return (
    <main className="relative h-dvh w-screen overflow-hidden">
      {loading && <LoadingMap />}

      <MapContainer onReady={handleMapReady}>
        <NeighborhoodLayer
          map={map}
          neighborhoods={neighborhoods}
          levelsById={levelsById}
          onSelect={setSelected}
        />
        <EmptyStateLayer map={map} cities={cities} />
      </MapContainer>

      <ProfileButton />

      <CityHeader cityName={selectedCity?.name ?? null} level={overallLevel} updatedAt={mostRecentUpdate} />

      <LocationButton onClick={handleLocationRequest} loading={location.status === "requesting"} />

      {!selected && (
        <AlertCard
          level={overallLevel}
          weather={
            selectedCurrent
              ? {
                  rain_1h: selectedCurrent.rain_1h,
                  rain_3h: selectedCurrent.rain_1h,
                  rain_72h: selectedCurrent.rain_72h,
                  rain_intensity: selectedCurrent.rain_intensity,
                  wind_speed: selectedCurrent.wind_speed,
                  wind_direction: selectedCurrent.wind_direction,
                  humidity: selectedCurrent.humidity,
                  pressure: selectedCurrent.pressure,
                  pressure_trend: "stable",
                }
              : null
          }
          tideLevel={selectedCurrent?.tide_level ?? null}
          onClick={() => {
            if (neighborhoods.length > 0) setSelected(neighborhoods[0]);
          }}
        />
      )}

      <Link
        href="/como-funciona"
        className="pointer-events-auto absolute right-4 top-4 z-[1000] rounded-full bg-brand-blue-deep/80 px-3 py-1.5 text-xs text-brand-blue-light shadow backdrop-blur-sm hover:bg-brand-blue-deep"
      >
        Como funciona
      </Link>

      <AnimatePresence>
        {showLocationBanner && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="pointer-events-auto absolute bottom-36 left-4 right-4 z-[1050] flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-xl md:bottom-20 md:left-1/2 md:right-auto md:w-[420px] md:-translate-x-1/2"
          >
            <span className="text-sm text-brand-gray-urban">Ver risco na minha localização</span>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLocationBanner(false)}
                className="rounded-full px-3 py-1.5 text-xs text-brand-gray-urban/60 hover:bg-brand-gray-light"
              >
                Agora não
              </button>
              <button
                onClick={handleLocationRequest}
                className="rounded-full bg-brand-blue-mid px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue-deep"
              >
                Permitir
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <DetailPanel
        neighborhood={selected}
        cityName={selectedCity?.name ?? ""}
        cityLat={selectedCity?.lat ?? null}
        cityLng={selectedCity?.lng ?? null}
        current={selectedCurrent}
        history={selectedHistory}
        onClose={() => setSelected(null)}
      />
    </main>
  );
}
