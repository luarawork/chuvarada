"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as turf from "@turf/turf";
import { motion, AnimatePresence } from "framer-motion";
import { MapContainer } from "@/components/map/MapContainer";
import { NeighborhoodLayer } from "@/components/map/NeighborhoodLayer";
import { CityMarkerLayer } from "@/components/map/CityMarkerLayer";
import { LocationButton } from "@/components/map/LocationButton";
import { EmptyStateLayer } from "@/components/map/EmptyStateLayer";
import { LoadingMap } from "@/components/ui/LoadingMap";
import { CityHeader } from "@/components/ui/CityHeader";
import { AlertCard } from "@/components/ui/AlertCard";
import { ProfileButton } from "@/components/ui/ProfileButton";
import { MapLegend } from "@/components/ui/MapLegend";
import { DetailPanel } from "@/components/panel/DetailPanel";
import { useMap, type MapBounds } from "@/hooks/useMap";
import { useLocation } from "@/hooks/useLocation";
import { useRealtime } from "@/hooks/useRealtime";
import { useRisk } from "@/hooks/useRisk";
import { useAuth } from "@/hooks/useAuth";
import { useFavorites } from "@/hooks/useFavorites";
import { supabase } from "@/lib/supabase";
import { findNeighborhoodAtPoint } from "@/lib/geojson";
import type { City, CitySummary, Neighborhood, RiskLevel, RiskScore } from "@/types";

// Abaixo desse zoom o mapa mostra pontos por cidade (CityMarkerLayer) em
// vez de polígonos de bairro -- num viewport largo o payload de geometria
// de bairro chega a ~9MB e demora perto de 1s só de transferência (ver
// diagnóstico de performance), sem contar que os polígonos ficam ilegíveis
// nessa escala. 10 é aproximadamente "zoom de estado/região" no Leaflet
// (cidade individual já aparece bem no nível 11-12).
const ZOOM_THRESHOLD = 10;
const CITY_MODE_FLY_ZOOM = 12;

// Página do PostgREST -- o projeto Supabase tem um teto rígido de 1000
// linhas por requisição (confirmado: nem um Range header explícito pedindo
// mais consegue passar disso), então "cities" (4.653 linhas) sempre precisa
// de paginação em loop, mesmo sem geometria (o teto é por LINHA, não por
// tamanho de payload). Ver diagnóstico "São Paulo não aparece no mapa".
const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllCities(): Promise<City[]> {
  const all: City[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("cities")
      .select("id, name, state, lat, lng, tide_code, data_level, active, created_at")
      .eq("active", true)
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      console.error("Erro ao buscar cities:", error);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...(data as City[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

interface NeighborhoodsResponse {
  neighborhoods: Neighborhood[];
  scores: Record<string, RiskScore>;
  truncated: boolean;
}

// Bairro pode ter score atualizado por 2 fontes concorrentes: o fetch do
// viewport (bbox) e o Supabase Realtime (INSERT em risk_scores). O fetch do
// viewport pode demorar (medido até ~5s num zoom-out grande) e resolver
// DEPOIS de um evento Realtime mais recente já ter chegado -- um merge cego
// (`{...prev, ...scores}`) deixaria o score antigo do fetch sobrescrever o
// score novo do Realtime, fazendo o polígono voltar a ficar verde mesmo com
// o painel (que busca direto por id, sem essa disputa) já mostrando
// crítico. Comparar calculated_at garante que a versão mais recente sempre
// vence, não importa qual fonte respondeu por último.
function mergeNewerScores(
  prev: Record<string, RiskScore>,
  incoming: Record<string, RiskScore>
): Record<string, RiskScore> {
  const next = { ...prev };
  for (const [id, score] of Object.entries(incoming)) {
    const existing = next[id];
    if (!existing || new Date(score.calculated_at) >= new Date(existing.calculated_at)) {
      next[id] = score;
    }
  }
  return next;
}

async function fetchNeighborhoodsForBounds(bounds: MapBounds): Promise<NeighborhoodsResponse> {
  const params = new URLSearchParams({
    north: bounds.north.toString(),
    south: bounds.south.toString(),
    east: bounds.east.toString(),
    west: bounds.west.toString(),
  });
  const res = await fetch(`/api/neighborhoods?${params}`);
  if (!res.ok) throw new Error(`Falha ao buscar bairros do viewport: ${res.status}`);
  return res.json();
}

async function fetchCitiesSummaryForBounds(bounds: MapBounds): Promise<CitySummary[]> {
  const params = new URLSearchParams({
    north: bounds.north.toString(),
    south: bounds.south.toString(),
    east: bounds.east.toString(),
    west: bounds.west.toString(),
  });
  const res = await fetch(`/api/cities-summary?${params}`);
  if (!res.ok) throw new Error(`Falha ao buscar agregado de cidades: ${res.status}`);
  const { cities } = await res.json();
  return cities as CitySummary[];
}

export default function HomePage() {
  const { map, bounds, zoom, handleMapReady, flyTo } = useMap();
  const location = useLocation();
  const { user } = useAuth();
  const { orderedIds: favoriteIds, loading: favoritesLoading } = useFavorites();
  const autoOpenedRef = useRef(false);
  // flyTo muda de identidade assim que `map` deixa de ser null (poucos ms
  // depois do mount, quando handleMapReady roda) -- se um efeito de fetch
  // assíncrono tivesse flyTo nas deps, esse reinício cancelaria o fetch em
  // andamento (via `cancelled = true` no cleanup) antes da resposta chegar.
  // Guardar numa ref deixa os efeitos abaixo chamarem a versão mais recente
  // sem precisar listá-la como dependência.
  const flyToRef = useRef(flyTo);
  useEffect(() => {
    flyToRef.current = flyTo;
  }, [flyTo]);

  const [cities, setCities] = useState<City[]>([]);
  const [emptyCityIds, setEmptyCityIds] = useState<Set<string>>(new Set());
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [latestScores, setLatestScores] = useState<Record<string, RiskScore>>({});
  const [citySummaries, setCitySummaries] = useState<CitySummary[]>([]);
  const [selected, setSelected] = useState<Neighborhood | null>(null);
  const [showLocationBanner, setShowLocationBanner] = useState(false);
  const [citiesLoaded, setCitiesLoaded] = useState(false);
  const [viewportLoadedOnce, setViewportLoadedOnce] = useState(false);
  const [citySummaryLoadedOnce, setCitySummaryLoadedOnce] = useState(false);

  // Antes do mapa estar pronto (zoom ainda null) assume modo bairro, pra não
  // mudar o comportamento de carregamento inicial existente -- o zoom real
  // chega já no handleMapReady, quase instantâneo.
  const mode: "city" | "neighborhood" = zoom !== null && zoom < ZOOM_THRESHOLD ? "city" : "neighborhood";
  const loading = !citiesLoaded || (mode === "city" ? !citySummaryLoadedOnce : !viewportLoadedOnce);

  const citiesById = useMemo(() => Object.fromEntries(cities.map((c) => [c.id, c])), [cities]);
  const neighborhoodIds = useMemo(() => neighborhoods.map((n) => n.id), [neighborhoods]);
  const realtimeUpdates = useRealtime(neighborhoodIds);
  const { current: selectedCurrent, history: selectedHistory, justUpdated: selectedJustUpdated } = useRisk(
    selected?.id ?? null
  );

  // Cidades e a lista (global, não-viewport) de município sem bairro nenhum
  // -- carregadas 1x, não mudam com a navegação no mapa.
  useEffect(() => {
    async function load() {
      const [citiesData, emptyRes] = await Promise.all([
        fetchAllCities(),
        fetch("/api/neighborhoods?emptyCities=true").then((r) => r.json()),
      ]);
      setCities(citiesData);
      setEmptyCityIds(new Set((emptyRes.cityIds as string[]) ?? []));
      setCitiesLoaded(true);
    }
    load();
  }, []);

  // Bairros do viewport atual -- recarrega (com debounce) toda vez que o
  // usuário navega o mapa. Substitui o antigo carregamento único de todos
  // os 24.556 bairros, que sempre batia no limite de 1000 linhas do
  // PostgREST (só ~4% do Brasil aparecia, nenhum bairro de São Paulo entre
  // eles -- ver diagnóstico "São Paulo não aparece no mapa"). Pausado no
  // modo cidade (zoom < ZOOM_THRESHOLD): nesse zoom os polígonos de bairro
  // nem aparecem (CityMarkerLayer no lugar), então buscar geometria
  // completa (MBs por request num viewport largo) seria desperdício.
  useEffect(() => {
    if (!bounds || mode !== "neighborhood") return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const { neighborhoods: data, scores, truncated } = await fetchNeighborhoodsForBounds(bounds);
        if (cancelled) return;
        setNeighborhoods(data);
        setLatestScores((prev) => mergeNewerScores(prev, scores));
        if (truncated) {
          console.warn(`/api/neighborhoods: resultado truncado no viewport atual -- dê zoom in pra ver todos os bairros.`);
        }
        setViewportLoadedOnce(true);
      } catch (err) {
        console.error("Erro ao buscar bairros do viewport:", err);
        setViewportLoadedOnce(true);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bounds, mode]);

  // Agregado por cidade pro modo "pontos" no zoom-out -- mesmo debounce e
  // padrão de cancelamento do efeito de bairros acima, só que contra
  // /api/cities-summary (tabela pré-agregada pelo cron, ver migração 022)
  // em vez de recalcular nada na hora.
  useEffect(() => {
    if (!bounds || mode !== "city") return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const data = await fetchCitiesSummaryForBounds(bounds);
        if (cancelled) return;
        setCitySummaries(data);
        setCitySummaryLoadedOnce(true);
      } catch (err) {
        console.error("Erro ao buscar agregado de cidades:", err);
        setCitySummaryLoadedOnce(true);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bounds, mode]);

  // Ao entrar no modo cidade, fecha o painel de bairro aberto -- não faz
  // sentido mostrar detalhe de 1 bairro com o mapa zoomado numa escala que
  // nem mostra polígonos de bairro.
  useEffect(() => {
    if (mode === "city") setSelected(null);
  }, [mode]);

  function handleSelectCity(city: CitySummary) {
    flyTo(city.lat, city.lng, CITY_MODE_FLY_ZOOM);
  }

  useEffect(() => {
    const timer = setTimeout(() => setShowLocationBanner(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    setLatestScores((prev) => mergeNewerScores(prev, realtimeUpdates));
  }, [realtimeUpdates]);

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
  // favoritos (?bairro=<id>). Roda só no mount (deps: []) -- não pode
  // depender de `user`/`favoritesLoading`/`flyTo`, porque qualquer um deles
  // mudando de identidade enquanto o fetch abaixo está em voo dispararia o
  // cleanup (`cancelled = true`) e descartaria a resposta já certa, mesmo
  // com `autoOpenedRef` impedindo um segundo fetch. bairroParam tem
  // prioridade sobre favoritos e não depende de autenticação, então não
  // precisa esperar nada.
  //
  // Busca o bairro-alvo direto por id (/api/neighborhoods?id=), em vez de
  // esperar ele aparecer em `neighborhoods` — esse array agora é escopado
  // pelo viewport atual do mapa, então um favorito em São Paulo nunca
  // apareceria ali se o mapa abrir centralizado no Nordeste.
  useEffect(() => {
    const bairroParam = new URLSearchParams(window.location.search).get("bairro");
    if (!bairroParam || autoOpenedRef.current) return;
    autoOpenedRef.current = true;

    fetch(`/api/neighborhoods?id=${bairroParam}`)
      .then((r) => r.json())
      .then(({ neighborhoods: found, scores }: NeighborhoodsResponse) => {
        if (found.length === 0) return;
        const target = found[0];
        setNeighborhoods((prev) => (prev.some((n) => n.id === target.id) ? prev : [...prev, target]));
        setLatestScores((prev) => mergeNewerScores(prev, scores));
        setSelected(target);
        const centroid = turf.centroid(target.geometry as GeoJSON.Geometry);
        const [lng, lat] = centroid.geometry.coordinates;
        flyToRef.current(lat, lng, 14);
      })
      .catch((err) => console.error("Erro ao buscar bairro-alvo:", err));
  }, []);

  // Se não veio por ?bairro= e o usuário está logado com favoritos, abre no
  // favorito mais recente assim que auth/favoritos resolverem. Mesma razão
  // do efeito acima para não incluir `flyTo` nas deps (usa flyToRef).
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (new URLSearchParams(window.location.search).get("bairro")) return;
    if (!user || favoritesLoading) return;
    if (favoriteIds.length === 0) {
      autoOpenedRef.current = true;
      return;
    }

    autoOpenedRef.current = true;
    let cancelled = false;
    const targetId = favoriteIds[0];

    fetch(`/api/neighborhoods?id=${targetId}`)
      .then((r) => r.json())
      .then(({ neighborhoods: found, scores }: NeighborhoodsResponse) => {
        if (cancelled || found.length === 0) return;
        const target = found[0];
        setNeighborhoods((prev) => (prev.some((n) => n.id === target.id) ? prev : [...prev, target]));
        setLatestScores((prev) => mergeNewerScores(prev, scores));
        setSelected(target);
        const centroid = turf.centroid(target.geometry as GeoJSON.Geometry);
        const [lng, lat] = centroid.geometry.coordinates;
        flyToRef.current(lat, lng, 14);
      })
      .catch((err) => console.error("Erro ao buscar bairro-alvo:", err));

    return () => {
      cancelled = true;
    };
  }, [user, favoritesLoading, favoriteIds]);

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
        {mode === "neighborhood" ? (
          <>
            <NeighborhoodLayer
              map={map}
              neighborhoods={neighborhoods}
              levelsById={levelsById}
              citiesById={citiesById}
              onSelect={setSelected}
            />
            <EmptyStateLayer map={map} cities={cities} emptyCityIds={emptyCityIds} />
          </>
        ) : (
          <CityMarkerLayer map={map} cities={citySummaries} onSelectCity={handleSelectCity} />
        )}
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
