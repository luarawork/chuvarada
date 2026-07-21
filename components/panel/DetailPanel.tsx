"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import * as turf from "@turf/turf";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { HistoryChart } from "./HistoryChart";
import { ForecastStrip } from "./ForecastStrip";
import { useForecast } from "@/hooks/useForecast";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useAuth } from "@/hooks/useAuth";
import { useFavorites } from "@/hooks/useFavorites";
import { hasRealName } from "@/lib/neighborhoodName";
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

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > 100) onClose();
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
          className="pointer-events-auto absolute inset-x-0 bottom-0 z-[1100] max-h-[80vh] overflow-y-auto rounded-t-3xl bg-white px-5 pb-8 pt-3 shadow-2xl md:inset-x-auto md:inset-y-0 md:left-auto md:right-4 md:top-20 md:bottom-4 md:max-h-none md:w-full md:max-w-lg md:rounded-3xl md:px-7 md:pb-7"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-brand-gray-light md:hidden" />

          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-heading text-xl font-bold text-brand-gray-urban">
                {hasRealName(neighborhood) ? neighborhood.name : "Área sem denominação oficial"}
              </h2>
              <p className="text-sm text-brand-gray-urban/60">{cityName}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (!user) {
                    router.push("/auth");
                    return;
                  }
                  if (neighborhood) toggleFavorite(neighborhood.id);
                }}
                aria-label={
                  !user ? "Entre para salvar bairros" : favorited ? "Remover dos favoritos" : "Salvar bairro"
                }
                title={!user ? "Entre para salvar bairros" : undefined}
                className={`rounded-full p-2 ${
                  user ? "text-brand-red-alert hover:bg-brand-gray-light" : "text-brand-gray-urban/30 hover:bg-brand-gray-light"
                }`}
              >
                <motion.svg
                  key={favorited ? "on" : "off"}
                  initial={{ scale: 0.7 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 15 }}
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill={favorited ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 21s-7.5-4.6-10-9.3C.5 8 2 4.5 5.5 4 8 3.6 10 5 12 7.5 14 5 16 3.6 18.5 4 22 4.5 23.5 8 22 11.7 19.5 16.4 12 21 12 21Z" />
                </motion.svg>
              </button>
              <button
                onClick={onClose}
                aria-label="Fechar"
                className="rounded-full p-2 text-brand-gray-urban/50 hover:bg-brand-gray-light"
              >
                ✕
              </button>
            </div>
          </div>

          {current && (
            <>
              <div className="mt-3 flex items-center gap-3">
                <RiskBadge level={current.level} score={current.score} />
                <AnimatePresence>
                  {justUpdated && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="rounded-full bg-brand-green-water/10 px-3 py-1 text-xs font-medium text-brand-green-water"
                    >
                      Atualizado agora
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              {current.auto_critical && current.auto_critical_reason && (
                <div className="mt-3 rounded-xl bg-brand-red-alert/10 px-4 py-3 text-sm text-brand-red-alert">
                  ⚠️ {current.auto_critical_reason}
                </div>
              )}

              <div className="mt-5">
                <ForecastStrip
                  forecast={forecast}
                  loading={forecastLoading}
                  neighborhood={neighborhood}
                  currentScore={current}
                  hasTideStation={hasTideStation}
                />
              </div>

              <div className="mt-5">
                <ScoreBreakdown score={current} hasTideStation={hasTideStation} />
              </div>

              <div className="mt-5">
                <h3 className="mb-2 text-sm font-medium text-brand-gray-urban/70">Últimas 6 horas</h3>
                <HistoryChart history={history} />
              </div>
            </>
          )}

          {!current && (
            <p className="mt-6 text-sm text-brand-gray-urban/60">
              Ainda não há dados suficientes para este bairro.
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
