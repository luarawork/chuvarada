"use client";

import { motion } from "framer-motion";
import { RainIcon, DropIcon, WaveIcon } from "./WeatherIcons";
import type { NormalizedWeather, RiskLevel } from "@/types";
import { RISK_COLORS } from "@/lib/constants";

const MESSAGES: Record<RiskLevel, { emoji: string; text: string; color: string }> = {
  normal: { emoji: "🟢", text: "Sem risco no momento", color: RISK_COLORS.normal },
  attention: { emoji: "🟡", text: "Fique atento à chuva", color: RISK_COLORS.attention },
  moderate: { emoji: "🟠", text: "Risco moderado de alagamento", color: RISK_COLORS.moderate },
  high: { emoji: "🔴", text: "Evite áreas alagáveis", color: RISK_COLORS.high },
  critical: { emoji: "🟣", text: "Evite áreas alagáveis — risco crítico", color: RISK_COLORS.critical },
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
    <div className="pointer-events-none absolute inset-x-0 bottom-40 z-[1000] flex justify-center px-4 md:bottom-4">
      <motion.button
        onClick={onClick}
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 20, stiffness: 200 }}
        className="pointer-events-auto w-full rounded-xl border px-4 py-3 text-left shadow-xl backdrop-blur md:w-[420px]"
        style={{
          backgroundColor: "rgba(13, 27, 42, 0.92)",
          borderColor: "rgba(46, 125, 184, 0.3)",
          color: "#f0f4f8",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">{message.emoji}</span>
          <span
            className="font-heading text-base font-semibold"
            style={{ color: message.color }}
          >
            {message.text}
          </span>
        </div>
        {weather && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" style={{ color: "#a8d4f0" }}>
            <span className="flex items-center gap-1.5">
              <RainIcon />
              {weather.rain_intensity.toFixed(1)}mm/h
            </span>
            <span aria-hidden>·</span>
            <span className="flex items-center gap-1.5">
              <DropIcon />
              {weather.humidity.toFixed(0)}% umidade
            </span>
            {tideLevel !== null && (
              <>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1.5">
                  <WaveIcon />
                  Maré {(tideLevel * 100).toFixed(0)}%
                </span>
              </>
            )}
          </div>
        )}
      </motion.button>
    </div>
  );
}
