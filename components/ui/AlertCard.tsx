"use client";

import { motion } from "framer-motion";
import { RainIcon, DropIcon, WaveIcon } from "./WeatherIcons";
import type { NormalizedWeather, RiskLevel } from "@/types";

const MESSAGES: Record<RiskLevel, { emoji: string; text: string; color: string }> = {
  normal: { emoji: "🟢", text: "Sem risco no momento", color: "#2a9d72" },
  attention: { emoji: "🟡", text: "Fique atento à chuva", color: "#f0a500" },
  critical: { emoji: "🔴", text: "Evite áreas alagáveis", color: "#d64045" },
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
      className="pointer-events-auto absolute bottom-40 left-4 right-4 z-[1000] rounded-2xl border px-5 py-4 text-left shadow-xl backdrop-blur md:bottom-4 md:left-1/2 md:right-auto md:w-[420px] md:-translate-x-1/2"
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
  );
}
