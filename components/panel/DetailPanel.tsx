"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import * as turf from "@turf/turf";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import { DetailHeader } from "./DetailHeader";
import { ForecastTabs } from "./ForecastTabs";
import { RiskFactors } from "./RiskFactors";
import { ScoreHistory } from "./ScoreHistory";
import { useForecast } from "@/hooks/useForecast";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useAuth } from "@/hooks/useAuth";
import { useFavorites } from "@/hooks/useFavorites";
import type { Neighborhood, RiskScore } from "@/types";

interface DetailPanelProps {
  neighborhood: Neighborhood | null;
  cityName: string;
  hasTideStation: boolean;
  current: RiskScore | null;
  history: RiskScore[];
  justUpdated?: boolean;
  onClose: () => void;
}

export function DetailPanel({
  neighborhood,
  cityName,
  hasTideStation,
  current,
  history,
  justUpdated = false,
  onClose,
}: DetailPanelProps) {
  // Previsão precisa ser do centroide do PRÓPRIO bairro, não do centro da
  // cidade — senão todo bairro de uma mesma cidade mostra a mesma previsão
  // e o mesmo índice de risco previsto (mesmo bug já corrigido no cron/score).
  const forecastCoords = useMemo(() => {
    if (!neighborhood) return null;
    const centroid = turf.centroid(neighborhood.geometry as GeoJSON.Geometry);
    const [lng, lat] = centroid.geometry.coordinates;
    return { lat, lng };
  }, [neighborhood]);

  const { forecast, loading: forecastLoading } = useForecast(
    forecastCoords?.lat ?? null,
    forecastCoords?.lng ?? null
  );
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const { user } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = neighborhood ? isFavorite(neighborhood.id) : false;
  const dragControls = useDragControls();

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > 100) onClose();
  }

  function handleToggleFavorite() {
    if (!user) {
      router.push("/auth");
      return;
    }
    if (neighborhood) toggleFavorite(neighborhood.id);
  }

  // No mobile é um bottom-sheet que desliza de baixo (com gesto de swipe
  // pra fechar). No desktop vira um painel lateral, deslizando da direita
  // — um bottom-sheet ocupando a tela toda fica estranho quando tem tanto
  // espaço horizontal sobrando.
  const motionProps = isDesktop
    ? {
        initial: { x: 40, opacity: 0 },
        animate: { x: 0, opacity: 1 },
        exit: { x: 40, opacity: 0 },
        transition: { type: "spring" as const, damping: 30, stiffness: 300 },
      }
    : {
        initial: { y: "100%" },
        animate: { y: 0 },
        exit: { y: "100%" },
        transition: { type: "spring" as const, damping: 28, stiffness: 260 },
        drag: "y" as const,
        // dragListener=false + dragControls.start() só no handle (abaixo) --
        // sem isso, o gesto de arrastar-pra-fechar do framer-motion competia
        // pelo mesmo touch-move que o scroll nativo do conteúdo (overflow-y-
        // auto, no mesmo elemento), travando o scroll no mobile: qualquer
        // arraste vertical dentro do painel era capturado como tentativa de
        // fechar o bottom-sheet em vez de rolar a lista.
        dragListener: false,
        dragControls,
        dragConstraints: { top: 0, bottom: 0 },
        dragElastic: { top: 0, bottom: 0.5 },
        onDragEnd: handleDragEnd,
      };

  return (
    <AnimatePresence>
      {neighborhood && (
        <motion.div
          key={neighborhood.id}
          {...motionProps}
          data-testid="detail-panel"
          className="pointer-events-auto fixed inset-x-0 bottom-0 z-[1100] max-h-[85dvh] overflow-y-auto rounded-t-2xl border px-3 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-3 shadow-2xl backdrop-blur-sm md:inset-x-auto md:inset-y-0 md:left-auto md:right-4 md:top-20 md:bottom-4 md:max-h-none md:w-full md:max-w-[380px] md:rounded-3xl md:px-5 md:pb-5"
          style={{ backgroundColor: "rgba(13, 27, 42, 0.96)", borderColor: "rgba(46, 125, 184, 0.2)" }}
        >
          <div
            className="mx-auto mb-3 h-1.5 w-10 touch-none rounded-full bg-brand-blue-light/20 md:hidden"
            onPointerDown={(e) => dragControls.start(e)}
          />

          <DetailHeader
            neighborhood={neighborhood}
            cityName={cityName}
            current={current}
            justUpdated={justUpdated}
            favorited={favorited}
            canFavorite={!!user}
            onToggleFavorite={handleToggleFavorite}
            onClose={onClose}
          />

          {current && (
            <>
              {current.auto_critical && current.auto_critical_reason && (
                <div className="mt-3 rounded-xl bg-brand-red-alert/10 px-4 py-3 text-sm text-brand-red-alert">
                  ⚠️ {current.auto_critical_reason}
                </div>
              )}

              <div className="mt-4">
                <ForecastTabs
                  neighborhoodId={neighborhood.id}
                  hourlyForecast={forecast}
                  hourlyLoading={forecastLoading}
                />
              </div>

              <div className="mt-5">
                <RiskFactors score={current} hasTideStation={hasTideStation} centroid={forecastCoords} />
              </div>

              <div className="mt-5">
                <ScoreHistory history={history} />
              </div>
            </>
          )}

          {!current && (
            <p className="mt-6 text-sm text-brand-blue-light/60">
              Ainda não há dados suficientes para este bairro.
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
