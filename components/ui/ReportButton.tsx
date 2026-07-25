"use client";

import { motion, AnimatePresence } from "framer-motion";

interface ReportButtonProps {
  active: boolean;
  onToggle: () => void;
}

// Sem posicionamento próprio -- renderizado dentro da pilha flex-col do
// canto superior direito (junto com ProfileButton), ver app/page.tsx.
// Enquanto ativo, o clique no mapa (ver app/page.tsx) marca o local do
// relato em vez do comportamento normal, e um banner no topo instrui o
// usuário (Esc cancela, ver o listener de keydown em page.tsx). O vermelho
// no estado ativo é intencional (semântica de "cancelar"), diferente do
// vidro escuro padrão dos outros botões circulares.
export function ReportButton({ active, onToggle }: ReportButtonProps) {
  return (
    <>
      <button
        onClick={onToggle}
        aria-label={active ? "Cancelar relato" : "Fazer um relato"}
        className={`pointer-events-auto relative flex h-9 w-9 items-center justify-center rounded-full border shadow-lg backdrop-blur transition before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] sm:h-10 sm:w-10 ${
          active ? "border-brand-red-alert bg-brand-red-alert text-white" : "text-brand-blue-light"
        }`}
        style={active ? undefined : { backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
      >
        {active ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3s6 6.8 6 11a6 6 0 1 1-12 0c0-4.2 6-11 6-11Z" />
            <path d="M12 12v4M10 14h4" />
          </svg>
        )}
      </button>

      {/* fixed, não absolute -- este banner é renderizado (via Fragment) DENTRO
          do stack pequeno de 80px do ReportButton+ProfileButton (ver
          app/page.tsx, className="absolute right-4 top-4..."), que é um
          ancestral posicionado. Com "absolute" o inset-x-0 resolvia contra
          esse container de 80px (containing block), não contra a viewport --
          o banner ficava espremido perto do canto superior direito em vez de
          centralizado no topo. "fixed" ignora ancestrais posicionados sem
          transform e sempre resolve contra a viewport.
          top-[72px] no mobile -- mesmo motivo do stack CityHeader/MapLegend:
          abaixo da SearchBar, que só centraliza a partir do sm. */}
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ y: -24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -24, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 300 }}
            className="pointer-events-none fixed inset-x-0 top-[72px] z-[1000] flex justify-center px-4 sm:top-4"
          >
            <div
              className="pointer-events-auto flex w-full max-w-[400px] items-center gap-2.5 rounded-xl px-5 py-3 shadow-lg backdrop-blur sm:w-auto sm:max-w-[480px]"
              style={{ backgroundColor: "rgba(46, 125, 184, 0.95)" }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d="M12 3s6 6.8 6 11a6 6 0 1 1-12 0c0-4.2 6-11 6-11Z" />
                <circle cx="12" cy="13" r="2" fill="white" stroke="none" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">Clique no mapa para marcar o alagamento</p>
                <p className="text-xs text-white/70">Pressione Esc para cancelar</p>
              </div>
              <button
                onClick={onToggle}
                aria-label="Cancelar relato"
                className="shrink-0 rounded-full p-1 text-white/70 transition hover:text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
