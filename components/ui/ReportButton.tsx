"use client";

import { motion, AnimatePresence } from "framer-motion";

interface ReportButtonProps {
  active: boolean;
  onToggle: () => void;
}

// Botão flutuante que ativa o "modo relato" -- enquanto ativo, o clique no
// mapa (ver app/page.tsx) marca o local do relato em vez do comportamento
// normal, e um banner no topo instrui o usuário (Esc cancela, ver o listener
// de keydown em page.tsx).
export function ReportButton({ active, onToggle }: ReportButtonProps) {
  return (
    <>
      <button
        onClick={onToggle}
        aria-label={active ? "Cancelar relato" : "Fazer um relato"}
        className={`pointer-events-auto absolute bottom-28 right-4 z-[1000] flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition ${
          active
            ? "bg-brand-red-alert text-white hover:bg-brand-red-alert/90"
            : "bg-brand-blue-mid text-white hover:bg-brand-blue-deep"
        }`}
      >
        {active ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3s6 6.8 6 11a6 6 0 1 1-12 0c0-4.2 6-11 6-11Z" />
            <path d="M12 12v4M10 14h4" />
          </svg>
        )}
      </button>

      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 top-4 z-[1000] flex justify-center px-4"
          >
            <div
              className="pointer-events-auto rounded-full px-4 py-2 text-sm shadow-lg backdrop-blur"
              style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", color: "#f0f4f8" }}
            >
              Toque no mapa para marcar o local do relato{" "}
              <span style={{ color: "#a8d4f0" }}>· Esc para cancelar</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
