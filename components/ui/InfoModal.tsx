"use client";

import { AnimatePresence, motion } from "framer-motion";

interface InfoModalProps {
  title: string;
  description: string;
  onClose: () => void;
}

export function InfoModal({ title, description, onClose }: InfoModalProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[1300] flex items-end justify-center bg-brand-blue-deep/40 backdrop-blur-[2px] md:items-center"
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-t-3xl bg-white p-6 shadow-2xl md:rounded-3xl"
        >
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-heading text-base font-bold text-brand-gray-urban">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="shrink-0 rounded-full p-1.5 text-brand-gray-urban/50 hover:bg-brand-gray-light"
            >
              ✕
            </button>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-brand-gray-urban/80">{description}</p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
