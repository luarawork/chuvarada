"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RISK_COLORS } from "@/lib/constants";

const ITEMS = [
  { color: RISK_COLORS.normal, label: "Normal" },
  { color: RISK_COLORS.attention, label: "Atenção" },
  { color: RISK_COLORS.moderate, label: "Moderado" },
  { color: RISK_COLORS.high, label: "Alto" },
  { color: RISK_COLORS.critical, label: "Crítico" },
];

// Sem posicionamento próprio -- renderizado dentro da pilha flex-col do
// canto superior esquerdo (junto com CityHeader), ver app/page.tsx.
export function MapLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="pointer-events-auto">
      {open ? (
        <Card
          className="w-56 rounded-xl border shadow-lg backdrop-blur"
          style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
        >
          <CardContent className="px-4 py-3">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-xs font-bold uppercase tracking-wide" style={{ color: "#a8d4f0" }}>
                Legenda
              </h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Fechar legenda"
                className="h-8 w-8 text-brand-gray-light/50 hover:bg-white/10 hover:text-brand-gray-light"
              >
                ✕
              </Button>
            </div>
            <ul className="mt-2 space-y-1.5">
              {ITEMS.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-xs" style={{ color: "#f0f4f8" }}>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.color, opacity: 0.7 }} />
                  {item.label}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          className="h-auto gap-2 rounded-xl border px-4 py-3 text-xs font-medium shadow-lg backdrop-blur"
          style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)", color: "#f0f4f8" }}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-brand-green-water" />
          <span className="h-2.5 w-2.5 rounded-full bg-brand-yellow-warn" />
          <span className="h-2.5 w-2.5 rounded-full bg-brand-orange-alert" />
          <span className="h-2.5 w-2.5 rounded-full bg-brand-red-alert" />
          <span className="h-2.5 w-2.5 rounded-full bg-brand-purple-critical" />
          Legenda
        </Button>
      )}
    </div>
  );
}
