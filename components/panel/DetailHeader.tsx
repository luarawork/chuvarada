"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { Button } from "@/components/ui/button";
import { LEVEL_TEXT_CLASS } from "@/lib/constants";
import { hasRealName } from "@/lib/neighborhoodName";
import type { Neighborhood, RiskScore } from "@/types";

interface DetailHeaderProps {
  neighborhood: Neighborhood;
  cityName: string;
  current: RiskScore | null;
  justUpdated: boolean;
  favorited: boolean;
  canFavorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
}

export function DetailHeader({
  neighborhood,
  cityName,
  current,
  justUpdated,
  favorited,
  canFavorite,
  onToggleFavorite,
  onClose,
}: DetailHeaderProps) {
  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold text-brand-gray-light">
            {hasRealName(neighborhood) ? neighborhood.name : "Área sem denominação oficial"}
          </h2>
          {/* text-brand-blue-light (não text-muted-foreground do shadcn) --
              é a cor de texto secundário usada em todo o resto do app
              (SearchBar, painéis, cards); trocar só aqui pro token genérico
              quebraria a consistência com o resto, não a criaria. */}
          <p className="text-sm text-brand-blue-light">{cityName}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleFavorite}
            aria-label={
              !canFavorite ? "Entre para salvar bairros" : favorited ? "Remover dos favoritos" : "Salvar bairro"
            }
            title={!canFavorite ? "Entre para salvar bairros" : undefined}
            className={`rounded-full hover:bg-white/10 ${
              canFavorite ? "text-brand-red-alert" : "text-brand-blue-light/30"
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
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full text-brand-blue-light/60 hover:bg-white/10"
          >
            ✕
          </Button>
        </div>
      </div>

      {current && (
        <div className="mt-3 flex items-center gap-3">
          <div>
            <RiskBadge level={current.level} />
            <p className="mt-0.5 flex items-baseline gap-1.5">
              <span className={`text-2xl font-bold tabular-nums ${LEVEL_TEXT_CLASS[current.level]}`}>
                {current.score.toFixed(1)}
              </span>
              <span className="text-xs text-brand-blue-light/70">score</span>
            </p>
          </div>
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
      )}
    </div>
  );
}
