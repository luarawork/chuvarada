"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup, CircleMarker as LeafletCircleMarker } from "leaflet";
import { RISK_COLORS } from "@/lib/geojson";
import type { CitySummary } from "@/types";

interface CityMarkerLayerProps {
  map: LeafletMap | null;
  cities: CitySummary[];
  onSelectCity: (city: CitySummary) => void;
}

const RADIUS_BY_LEVEL: Record<CitySummary["worst_level"], number> = {
  critical: 10,
  attention: 8,
  normal: 5,
};

// Modo "pontos" do mapa no zoom-out (abaixo de ZOOM_THRESHOLD em
// app/page.tsx) -- em vez dos polígonos de bairro (pesados demais e
// ilegíveis nessa escala, ver diagnóstico de performance), 1 CircleMarker
// por cidade colorido pelo pior nível entre seus bairros.
export function CityMarkerLayer({ map, cities, onSelectCity }: CityMarkerLayerProps) {
  const groupRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled) return;
      groupRef.current?.remove();

      const group = L.layerGroup();

      cities.forEach((city) => {
        const color = RISK_COLORS[city.worst_level];
        const marker: LeafletCircleMarker = L.circleMarker([city.lat, city.lng], {
          radius: RADIUS_BY_LEVEL[city.worst_level],
          fillColor: color,
          fillOpacity: 0.85,
          color: "white",
          weight: 1.5,
        });

        const parts = [`<strong>${city.name} (${city.state})</strong>`];
        if (city.critical_count > 0) parts.push(`${city.critical_count} bairro(s) crítico(s)`);
        if (city.attention_count > 0) parts.push(`${city.attention_count} em atenção`);
        marker.bindTooltip(parts.join("<br>"), { sticky: true });

        marker.on("click", () => onSelectCity(city));
        marker.addTo(group);
      });

      group.addTo(map);
      groupRef.current = group;
    });

    return () => {
      cancelled = true;
      groupRef.current?.remove();
    };
  }, [map, cities, onSelectCity]);

  return null;
}
