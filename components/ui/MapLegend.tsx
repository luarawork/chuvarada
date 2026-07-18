"use client";

import { useState } from "react";

const ITEMS = [
  { color: "#2a9d72", label: "Normal" },
  { color: "#f0a500", label: "Atenção" },
  { color: "#d64045", label: "Crítico" },
];

export function MapLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="pointer-events-auto absolute bottom-16 right-4 z-[1000]">
      {open ? (
        <div className="w-56 rounded-2xl bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-xs font-bold uppercase tracking-wide text-brand-gray-urban/70">
              Legenda
            </h3>
            <button
              onClick={() => setOpen(false)}
              aria-label="Fechar legenda"
              className="text-brand-gray-urban/50 hover:text-brand-gray-urban"
            >
              ✕
            </button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {ITEMS.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-xs text-brand-gray-urban">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color, opacity: 0.7 }}
                />
                {item.label}
              </li>
            ))}
            <li className="flex items-center gap-2 text-xs text-brand-gray-urban">
              <span className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-dashed border-brand-gray-urban/60 bg-brand-gray-urban/30" />
              Sem bairro ainda (em expansão)
            </li>
          </ul>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-brand-gray-urban shadow-lg hover:bg-brand-gray-light"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-brand-green-water" />
          <span className="h-2.5 w-2.5 rounded-full bg-brand-yellow-warn" />
          <span className="h-2.5 w-2.5 rounded-full bg-brand-red-alert" />
          Legenda
        </button>
      )}
    </div>
  );
}
