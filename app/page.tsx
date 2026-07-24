"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as turf from "@turf/turf";
import { MapContainer } from "@/components/map/MapContainer";
import { NeighborhoodLayer } from "@/components/map/NeighborhoodLayer";
import { MunicipalityLayer } from "@/components/map/MunicipalityLayer";
import { EmptyStateLayer } from "@/components/map/EmptyStateLayer";
import { ReportLayer } from "@/components/map/ReportLayer";
import { LoadingMap } from "@/components/ui/LoadingMap";
import { CityHeader } from "@/components/ui/CityHeader";
import { AlertCard } from "@/components/ui/AlertCard";
import { ProfileButton } from "@/components/ui/ProfileButton";
import { MapLegend } from "@/components/ui/MapLegend";
import { SearchBar } from "@/components/ui/SearchBar";
import { ReportButton } from "@/components/ui/ReportButton";
import { ReportModal } from "@/components/ui/ReportModal";
import { DetailPanel } from "@/components/panel/DetailPanel";
import { useMap, type MapBounds } from "@/hooks/useMap";
import { useRealtime } from "@/hooks/useRealtime";
import { useReports } from "@/hooks/useReports";
import { useRisk } from "@/hooks/useRisk";
import { useAuth } from "@/hooks/useAuth";
import { useFavorites } from "@/hooks/useFavorites";
import { supabase } from "@/lib/supabase";
import type { City, MunicipalitySummary, Neighborhood, ReportSeverity, RiskLevel, RiskScore } from "@/types";

// 3 modos de zoom -- abaixo de 10 o mapa mostra polígonos municipais
// (MunicipalityLayer) em vez de bairro: num viewport largo o payload de
// geometria de bairro chega a ~9MB e demora perto de 1s só de transferência
// (ver diagnóstico de performance), sem contar que os polígonos de bairro
// ficam ilegíveis nessa escala. Dentro da faixa "município", o zoom bem
// afastado (< 7, ~país/região) ganha estilo ainda mais translúcido com
// rótulo de nome (heatmap), e o zoom intermediário (7-10, ~estado) ganha
// polígono mais opaco sem rótulo fixo (municipality). 10 é aproximadamente
// "zoom de estado/região" no Leaflet (cidade individual já aparece bem no
// nível 11-12).
type MapMode = "heatmap" | "municipality" | "neighborhood";

function getMapMode(zoom: number): MapMode {
  if (zoom < 7) return "heatmap";
  if (zoom < 10) return "municipality";
  return "neighborhood";
}

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

async function fetchMunicipalitiesForBounds(bounds: MapBounds): Promise<MunicipalitySummary[]> {
  const params = new URLSearchParams({
    north: bounds.north.toString(),
    south: bounds.south.toString(),
    east: bounds.east.toString(),
    west: bounds.west.toString(),
  });
  const res = await fetch(`/api/municipalities?${params}`);
  if (!res.ok) throw new Error(`Falha ao buscar municípios do viewport: ${res.status}`);
  const { data } = await res.json();
  return data as MunicipalitySummary[];
}

export default function HomePage() {
  const { map, bounds, zoom, handleMapReady, flyTo } = useMap();
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
  const [municipalities, setMunicipalities] = useState<MunicipalitySummary[]>([]);
  const [selected, setSelected] = useState<Neighborhood | null>(null);
  const [citiesLoaded, setCitiesLoaded] = useState(false);
  const [viewportLoadedOnce, setViewportLoadedOnce] = useState(false);
  const [municipalitiesLoadedOnce, setMunicipalitiesLoadedOnce] = useState(false);
  const [reportMode, setReportMode] = useState(false);
  const [pendingReportLocation, setPendingReportLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Antes do mapa estar pronto (zoom ainda null) assume modo bairro, pra não
  // mudar o comportamento de carregamento inicial existente -- o zoom real
  // chega já no handleMapReady, quase instantâneo.
  const mode: MapMode = zoom !== null ? getMapMode(zoom) : "neighborhood";
  const loading = !citiesLoaded || (mode === "neighborhood" ? !viewportLoadedOnce : !municipalitiesLoadedOnce);

  const citiesById = useMemo(() => Object.fromEntries(cities.map((c) => [c.id, c])), [cities]);
  const neighborhoodIds = useMemo(() => neighborhoods.map((n) => n.id), [neighborhoods]);
  const realtimeUpdates = useRealtime(neighborhoodIds);
  const reports = useReports(bounds);
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
  // eles -- ver diagnóstico "São Paulo não aparece no mapa"). Pausado fora
  // do modo bairro (zoom < 10): nesse zoom os polígonos de bairro nem
  // aparecem (MunicipalityLayer no lugar), então buscar geometria completa
  // (MBs por request num viewport largo) seria desperdício.
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

  // Polígonos municipais pros modos heatmap/municipality no zoom-out --
  // mesmo debounce e padrão de cancelamento do efeito de bairros acima, só
  // que contra /api/municipalities (tabela municipalities + agregado
  // city_risk_summary, ver migração 023) em vez de recalcular nada na hora.
  useEffect(() => {
    if (!bounds || mode === "neighborhood") return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const data = await fetchMunicipalitiesForBounds(bounds);
        if (cancelled) return;
        setMunicipalities(data);
        setMunicipalitiesLoadedOnce(true);
      } catch (err) {
        console.error("Erro ao buscar municípios do viewport:", err);
        setMunicipalitiesLoadedOnce(true);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bounds, mode]);

  // Ao sair do modo bairro, fecha o painel de bairro aberto -- não faz
  // sentido mostrar detalhe de 1 bairro com o mapa zoomado numa escala que
  // nem mostra polígonos de bairro.
  useEffect(() => {
    if (mode !== "neighborhood") setSelected(null);
  }, [mode]);

  // Modo relato -- enquanto ativo, o próximo clique no mapa marca o local do
  // relato (abre o ReportModal) em vez de qualquer seleção normal. Cursor
  // crosshair dá o mesmo feedback visual de "modo especial" que outros apps
  // de mapa usam pra marcação de ponto.
  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();
    container.style.cursor = reportMode ? "crosshair" : "";

    if (!reportMode) return;

    function handleMapClick(e: { latlng: { lat: number; lng: number } }) {
      setPendingReportLocation({ lat: e.latlng.lat, lng: e.latlng.lng });
      setReportMode(false);
    }

    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [map, reportMode]);

  // Esc cancela o modo relato (ver banner em ReportButton).
  useEffect(() => {
    if (!reportMode) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setReportMode(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [reportMode]);

  useEffect(() => {
    setLatestScores((prev) => mergeNewerScores(prev, realtimeUpdates));
  }, [realtimeUpdates]);

  const levelsById = useMemo(() => {
    const map: Record<string, RiskLevel> = {};
    for (const [id, score] of Object.entries(latestScores)) map[id] = score.level;
    return map;
  }, [latestScores]);

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

  async function handleReportSubmit(severity: ReportSeverity, description: string) {
    if (!pendingReportLocation) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch("/api/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        lat: pendingReportLocation.lat,
        lng: pendingReportLocation.lng,
        severity,
        description: description || undefined,
      }),
    });

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Falha ao enviar relato" }));
      throw new Error(error);
    }

    setPendingReportLocation(null);
  }

  async function handleReportReact(reportId: string, reaction: "confirm" | "deny") {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    await fetch(`/api/reports/${reportId}/react`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ reaction }),
    }).catch((err) => console.error("Erro ao reagir ao relato:", err));
  }

  // Diferente de handleReportReact (que precisa atualizar confirmations/
  // denials de OUTRO usuário, por isso passa pela rota server-side com pg
  // cru -- ver app/api/reports/[id]/react/route.ts), resolver o próprio
  // relato é uma escrita simples do dono sobre a própria linha, exatamente
  // o caso que a policy "reports_owner_update" (auth.uid() = user_id) já
  // cobre -- dá pra ir direto pelo supabase-js client-side, sem endpoint.
  async function handleReportResolve(reportId: string) {
    if (!user) return;
    const { error } = await supabase
      .from("user_reports")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", reportId)
      .eq("user_id", user.id);
    if (error) console.error("Erro ao resolver relato:", error);
  }

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
          <MunicipalityLayer map={map} municipalities={municipalities} variant={mode} />
        )}
        <ReportLayer
          map={map}
          reports={reports}
          currentUserId={user?.id ?? null}
          onReact={handleReportReact}
          onResolve={handleReportResolve}
        />
      </MapContainer>

      <ProfileButton />

      <SearchBar onSelect={flyTo} />

      <CityHeader cityName={selectedCity?.name ?? null} level={overallLevel} updatedAt={mostRecentUpdate} />

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

      <ReportButton active={reportMode} onToggle={() => setReportMode((v) => !v)} />

      {pendingReportLocation && (
        <ReportModal onClose={() => setPendingReportLocation(null)} onSubmit={handleReportSubmit} />
      )}

      <Link
        href="/como-funciona"
        className="pointer-events-auto absolute bottom-4 right-4 z-[1000] rounded-full bg-brand-blue-deep/80 px-3 py-1.5 text-xs text-brand-blue-light shadow backdrop-blur-sm hover:bg-brand-blue-deep"
      >
        Como funciona
      </Link>

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
