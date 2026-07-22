"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, LayerGroup } from "leaflet";
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

function shouldShowLabel(city: MunicipalitySummary) {
  return city.worst_level !== "normal" || city.critical_count > 0 || city.attention_count > 0;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Polígonos municipais pros modos heatmap (zoom < 7) e municipality (zoom
// 7-10) -- ver getMapMode em app/page.tsx. No zoom bem afastado (heatmap) o
// polígono sozinho é translúcido demais pra comunicar risco, então cidades
// com algum nível de atenção/crítico ganham um rótulo de texto (DivIcon)
// com o nome por cima; no zoom intermediário (municipality) o polígono já
// fica mais opaco/visível e um rótulo fixo por cidade viraria poluição
// visual, por isso vira tooltip só no hover.
export function MunicipalityLayer({ map, municipalities, variant }: MunicipalityLayerProps) {
  const polygonLayerRef = useRef<LeafletGeoJSON | null>(null);
  const labelGroupRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled) return;

      polygonLayerRef.current?.remove();
      labelGroupRef.current?.remove();

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

      if (variant === "heatmap") {
        const labelGroup = L.layerGroup();
        municipalities.filter(shouldShowLabel).forEach((city) => {
          const icon = L.divIcon({
            className: "",
            html: `<span style="color: white; font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 500; text-shadow: 0 1px 3px rgba(0,0,0,0.9); white-space: nowrap; pointer-events: none; user-select: none;">${escapeHtml(city.name)}</span>`,
            iconAnchor: [0, 0],
          });
          L.marker([city.centroid_lat, city.centroid_lng], { icon, interactive: false }).addTo(labelGroup);
        });
        labelGroup.addTo(map);
        labelGroupRef.current = labelGroup;
      }
    });

    return () => {
      cancelled = true;
      polygonLayerRef.current?.remove();
      labelGroupRef.current?.remove();
    };
  }, [map, municipalities, variant]);

  return null;
}
