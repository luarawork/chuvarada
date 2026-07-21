"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as turf from "@turf/turf";
import { motion, AnimatePresence } from "framer-motion";
import { MapContainer } from "@/components/map/MapContainer";
import { NeighborhoodLayer } from "@/components/map/NeighborhoodLayer";
import { LocationButton } from "@/components/map/LocationButton";
import { EmptyStateLayer } from "@/components/map/EmptyStateLayer";
import { LoadingMap } from "@/components/ui/LoadingMap";
import { CityHeader } from "@/components/ui/CityHeader";
import { AlertCard } from "@/components/ui/AlertCard";
import { ProfileButton } from "@/components/ui/ProfileButton";
import { MapLegend } from "@/components/ui/MapLegend";
import { DetailPanel } from "@/components/panel/DetailPanel";
import { useMap } from "@/hooks/useMap";
import { useLocation } from "@/hooks/useLocation";
import { useRealtime } from "@/hooks/useRealtime";
import { useRisk } from "@/hooks/useRisk";
import { useAuth } from "@/hooks/useAuth";
import { useFavorites } from "@/hooks/useFavorites";
import { supabase } from "@/lib/supabase";
import { findNeighborhoodAtPoint } from "@/lib/geojson";
import type { City, Neighborhood, RiskLevel, RiskScore } from "@/types";

export default function HomePage() {
  const { map, handleMapReady, flyTo } = useMap();
  const location = useLocation();
  const { user } = useAuth();
  const { orderedIds: favoriteIds, loading: favoritesLoading } = useFavorites();
  const autoOpenedRef = useRef(false);

  const [cities, setCities] = useState<City[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [latestScores, setLatestScores] = useState<Record<string, RiskScore>>({});
  const [selected, setSelected] = useState<Neighborhood | null>(null);
  const [showLocationBanner, setShowLocationBanner] = useState(false);
  const [loading, setLoading] = useState(true);

  const citiesById = useMemo(() => Object.fromEntries(cities.map((c) => [c.id, c])), [cities]);
  const neighborhoodIds = useMemo(() => neighborhoods.map((n) => n.id), [neighborhoods]);
  const realtimeUpdates = useRealtime(neighborhoodIds);
  const { current: selectedCurrent, history: selectedHistory, justUpdated: selectedJustUpdated } = useRisk(
    selected?.id ?? null
  );

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

  // Abre direto num bairro específico ao chegar via link da página de
  // favoritos (?bairro=<id>), ou — se o usuário está logado e tem
  // favoritos — no bairro favoritado mais recentemente. Só tenta uma vez
  // por carregamento, pra não reabrir o painel depois que o usuário fechar.
  useEffect(() => {
    if (autoOpenedRef.current || neighborhoods.length === 0) return;

    // Lê a query string direto do window em vez de usar useSearchParams —
    // esse hook exige envolver a página inteira num <Suspense>, o que
    // causava divergência entre o HTML renderizado no servidor e no
    // cliente (a página já é 100% client-side, não precisa desse boundary).
    const bairroParam = new URLSearchParams(window.location.search).get("bairro");
    let target: Neighborhood | undefined;

    if (bairroParam) {
      target = neighborhoods.find((n) => n.id === bairroParam);
    } else if (user && !favoritesLoading && favoriteIds.length > 0) {
      target = neighborhoods.find((n) => n.id === favoriteIds[0]);
    } else if (!bairroParam && (!user || favoritesLoading)) {
      return; // ainda esperando saber se tem usuário/favoritos
    }

    if (!target) {
      if (bairroParam || (user && !favoritesLoading)) autoOpenedRef.current = true;
      return;
    }

    autoOpenedRef.current = true;
    setSelected(target);
    const centroid = turf.centroid(target.geometry as GeoJSON.Geometry);
    const [lng, lat] = centroid.geometry.coordinates;
    flyTo(lat, lng, 14);
  }, [neighborhoods, user, favoritesLoading, favoriteIds, flyTo]);

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

  // O AlertCard só aparece quando nenhum bairro está selecionado, então usar
  // selectedCurrent (que depende de `selected`) pra ele fazia a previsão de
  // clima nunca aparecer — sempre vinha null. Usa o mesmo bairro que o
  // onClick do card abre, pra ficar consistente com o que o usuário vê ao clicar.
  const previewNeighborhood = neighborhoods[0] ?? null;
  const previewScore = previewNeighborhood ? latestScores[previewNeighborhood.id] ?? null : null;

  return (
    <main className="relative h-dvh w-screen overflow-hidden">
      {loading && <LoadingMap />}

      <MapContainer onReady={handleMapReady}>
        <NeighborhoodLayer
          map={map}
          neighborhoods={neighborhoods}
          levelsById={levelsById}
          citiesById={citiesById}
          onSelect={setSelected}
        />
        <EmptyStateLayer map={map} cities={cities} neighborhoods={neighborhoods} />
      </MapContainer>

      <ProfileButton />

      <CityHeader cityName={selectedCity?.name ?? null} level={overallLevel} updatedAt={mostRecentUpdate} />

      <LocationButton onClick={handleLocationRequest} loading={location.status === "requesting"} />

      {!selected && (
        <AlertCard
          level={overallLevel}
          weather={
            previewScore
              ? {
                  rain_1h: previewScore.rain_1h,
                  rain_3h: previewScore.rain_1h,
                  rain_72h: previewScore.rain_72h,
                  rain_intensity: previewScore.rain_intensity,
                  rain_peak_3h: previewScore.rain_peak_3h,
                  rain_source: "openmeteo",
                  wind_speed: previewScore.wind_speed,
                  wind_direction: previewScore.wind_direction,
                  humidity: previewScore.humidity,
                  pressure: previewScore.pressure,
                  pressure_trend: "stable",
                }
              : null
          }
          tideLevel={
            previewScore && previewNeighborhood && citiesById[previewNeighborhood.city_id]?.tide_code != null
              ? previewScore.tide_level
              : null
          }
          onClick={() => {
            if (previewNeighborhood) setSelected(previewNeighborhood);
          }}
        />
      )}

      <MapLegend />

      <Link
        href="/como-funciona"
        className="pointer-events-auto absolute bottom-4 right-4 z-[1000] rounded-full bg-brand-blue-deep/80 px-3 py-1.5 text-xs text-brand-blue-light shadow backdrop-blur-sm hover:bg-brand-blue-deep"
      >
        Como funciona
      </Link>

      <AnimatePresence>
        {showLocationBanner && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="pointer-events-auto absolute bottom-60 left-4 right-4 z-[1050] flex items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur md:bottom-20 md:left-1/2 md:right-auto md:w-[420px] md:-translate-x-1/2"
            style={{
              backgroundColor: "rgba(13, 27, 42, 0.95)",
              borderColor: "rgba(46, 125, 184, 0.3)",
            }}
          >
            <span className="text-sm" style={{ color: "#f0f4f8" }}>
              Ver risco na minha localização
            </span>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setShowLocationBanner(false)}
                className="rounded-lg px-3 py-1.5 text-xs transition hover:text-[#f0f4f8]"
                style={{ color: "#a8d4f0" }}
              >
                Agora não
              </button>
              <button
                onClick={handleLocationRequest}
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1a3a5c]"
                style={{ backgroundColor: "#2e7db8", borderColor: "#2e7db8" }}
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
        hasTideStation={selectedCity?.tide_code != null}
        current={selectedCurrent}
        history={selectedHistory}
        justUpdated={selectedJustUpdated}
        onClose={() => setSelected(null)}
      />
    </main>
  );
}
