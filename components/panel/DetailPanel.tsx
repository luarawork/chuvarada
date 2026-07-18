"use client";

import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { TrendIndicators } from "./TrendIndicators";
import { HistoryChart } from "./HistoryChart";
import { ForecastStrip } from "./ForecastStrip";
import { useForecast } from "@/hooks/useForecast";
import type { Neighborhood, RiskScore } from "@/types";

interface DetailPanelProps {
  neighborhood: Neighborhood | null;
  cityName: string;
  cityLat: number | null;
  cityLng: number | null;
  current: RiskScore | null;
  history: RiskScore[];
  onClose: () => void;
}

export function DetailPanel({
  neighborhood,
  cityName,
  cityLat,
  cityLng,
  current,
  history,
  onClose,
}: DetailPanelProps) {
  const { forecast, loading: forecastLoading } = useForecast(
    neighborhood ? cityLat : null,
    neighborhood ? cityLng : null
  );

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > 100) onClose();
  }

  return (
    <AnimatePresence>
      {neighborhood && (
        <motion.div
          key={neighborhood.id}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 260 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          onDragEnd={handleDragEnd}
          className="pointer-events-auto absolute inset-x-0 bottom-0 z-[1100] max-h-[80vh] overflow-y-auto rounded-t-3xl bg-white px-5 pb-8 pt-3 shadow-2xl"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-brand-gray-light" />

          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-heading text-xl font-bold text-brand-gray-urban">
                {neighborhood.name}
              </h2>
              <p className="text-sm text-brand-gray-urban/60">{cityName}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-full p-2 text-brand-gray-urban/50 hover:bg-brand-gray-light"
            >
              ✕
            </button>
          </div>

          {current && (
            <>
              <RiskBadge level={current.level} score={current.score} className="mt-3" />

              {current.auto_critical && current.auto_critical_reason && (
                <div className="mt-3 rounded-xl bg-brand-red-alert/10 px-4 py-3 text-sm text-brand-red-alert">
                  ⚠️ {current.auto_critical_reason}
                </div>
              )}

              <div className="mt-5">
                <ForecastStrip forecast={forecast} loading={forecastLoading} />
              </div>

              <div className="mt-5">
                <ScoreBreakdown score={current} />
              </div>

              <div className="mt-5">
                <TrendIndicators score={current} />
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
