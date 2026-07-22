"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON } from "leaflet";
import type { MunicipalitySummary, RiskLevel } from "@/types";

interface MunicipalityLayerProps {
  map: LeafletMap | null;
  municipalities: MunicipalitySummary[];
  variant: "heatmap" | "municipality";
}

const LEVEL_COLOR: Record<RiskLevel, string> = {
  critical: "#d64045",
  attention: "#f0a500",
  normal: "#2a9d72",
};

const LEVEL_LABELS: Record<RiskLevel, string> = {
  normal: "normal",
  attention: "atenção",
  critical: "crítico",
};

const heatmapStyle = (level: RiskLevel) => ({
  fillColor: LEVEL_COLOR[level],
  fillOpacity: 0.2,
  color: "transparent",
  weight: 0,
});

const municipalityStyle = (level: RiskLevel) => ({
  fillColor: LEVEL_COLOR[level],
  fillOpacity: 0.4,
  color: LEVEL_COLOR[level],
  weight: 0.8,
  opacity: 0.7,
});

// Polígonos municipais pros modos heatmap (zoom < 7) e municipality (zoom
// 7-10) -- ver getMapMode em app/page.tsx. Heatmap fica só com o polígono
// bem translúcido; municipality é mais opaco e ganha tooltip com nome/nível
// no hover (um rótulo fixo por cidade nesse zoom viraria poluição visual).
export function MunicipalityLayer({ map, municipalities, variant }: MunicipalityLayerProps) {
  const polygonLayerRef = useRef<LeafletGeoJSON | null>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled) return;

      polygonLayerRef.current?.remove();

      const style = variant === "heatmap" ? heatmapStyle : municipalityStyle;

      const polygonLayer = L.geoJSON(
        municipalities.map((m) => ({
          type: "Feature" as const,
          properties: { id: m.id },
          geometry: m.geometry as GeoJSON.Geometry,
        })),
        {
          style: (feature) => {
            const municipality = municipalities.find((m) => m.id === feature?.properties?.id);
            return style(municipality?.worst_level ?? "normal");
          },
          onEachFeature: (feature, layerInstance) => {
            if (variant !== "municipality") return;
            const municipality = municipalities.find((m) => m.id === feature.properties.id);
            if (!municipality) return;
            layerInstance.bindTooltip(`${municipality.name} — ${LEVEL_LABELS[municipality.worst_level]}`);
          },
        }
      ).addTo(map);
      polygonLayerRef.current = polygonLayer;
    });

    return () => {
      cancelled = true;
      polygonLayerRef.current?.remove();
    };
  }, [map, municipalities, variant]);

  return null;
}
