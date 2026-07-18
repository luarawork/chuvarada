"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { City, DataLevel } from "@/types";

const BADGE_TEXT: Record<Exclude<DataLevel, "full">, { label: string; tooltip: string }> = {
  partial: {
    label: "Cobertura parcial",
    tooltip: "Dados parciais — modelo baseado em hidrografia regional",
  },
  minimal: {
    label: "Em expansão",
    tooltip: "Modelo baseado apenas em clima e terreno — expandindo cobertura",
  },
};

interface EmptyStateLayerProps {
  map: LeafletMap | null;
  cities: City[];
}

export function EmptyStateLayer({ map, cities }: EmptyStateLayerProps) {
  const groupRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled) return;
      groupRef.current?.remove();

      const group = L.layerGroup();

      cities
        .filter((c) => c.data_level !== "full")
        .forEach((city) => {
          const isTeresina = city.name === "Teresina";
          const tooltip = isTeresina
            ? "Dado de maré não aplicável — cidade não costeira"
            : BADGE_TEXT[city.data_level as "partial" | "minimal"].tooltip;
          const label = isTeresina ? "Em expansão" : BADGE_TEXT[city.data_level as "partial" | "minimal"].label;

          const color = city.data_level === "partial" ? "#f0a500" : "#4a5568";

          const marker = L.circleMarker([city.lat, city.lng], {
            radius: 6,
            color,
            fillColor: color,
            fillOpacity: 0.6,
            weight: 1,
            dashArray: "2,2",
          }).bindTooltip(`${label}: ${tooltip}`);

          marker.addTo(group);
        });

      group.addTo(map);
      groupRef.current = group;
    });

    return () => {
      cancelled = true;
      groupRef.current?.remove();
    };
  }, [map, cities]);

  return null;
}
