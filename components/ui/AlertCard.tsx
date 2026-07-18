"use client";

import { motion } from "framer-motion";
import type { NormalizedWeather, RiskLevel } from "@/types";

const MESSAGES: Record<RiskLevel, { emoji: string; text: string }> = {
  normal: { emoji: "🟢", text: "Sem risco no momento" },
  attention: { emoji: "🟡", text: "Fique atento à chuva" },
  critical: { emoji: "🔴", text: "Evite áreas alagáveis" },
};

interface AlertCardProps {
  level: RiskLevel;
  weather: NormalizedWeather | null;
  tideLevel: number | null;
  onClick: () => void;
}

export function AlertCard({ level, weather, tideLevel, onClick }: AlertCardProps) {
  const message = MESSAGES[level];

  return (
    <motion.button
      onClick={onClick}
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", damping: 20, stiffness: 200 }}
      className="pointer-events-auto absolute bottom-4 left-4 right-4 z-[1000] rounded-2xl bg-white px-5 py-4 text-left shadow-xl md:left-1/2 md:right-auto md:w-[420px] md:-translate-x-1/2"
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">{message.emoji}</span>
        <span className="font-heading text-base font-semibold text-brand-gray-urban">
          {message.text}
        </span>
      </div>
      {weather && (
        <div className="mt-2 flex flex-wrap gap-3 text-sm text-brand-gray-urban/80">
          <span>🌧 {weather.rain_intensity.toFixed(1)}mm/h</span>
          <span>💧 {weather.humidity.toFixed(0)}% umidade</span>
          {tideLevel !== null && <span>🌊 Maré {(tideLevel * 100).toFixed(0)}%</span>}
        </div>
      )}
    </motion.button>
  );
}
