"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Layer } from "leaflet";
import { NEIGHBORHOOD_STYLES, NEIGHBORHOOD_HOVER_STYLE } from "@/lib/geojson";
import { hasRealName } from "@/lib/neighborhoodName";
import type { City, Neighborhood, RiskLevel } from "@/types";

const LEVEL_LABELS: Record<RiskLevel, string> = {
  normal: "normal",
  attention: "atenção",
  critical: "crítico",
};

interface NeighborhoodLayerProps {
  map: LeafletMap | null;
  neighborhoods: Neighborhood[];
  levelsById: Record<string, RiskLevel>;
  citiesById: Record<string, City>;
  pulsingId?: string | null;
  onSelect: (neighborhood: Neighborhood) => void;
}

export function NeighborhoodLayer({
  map,
  neighborhoods,
  levelsById,
  citiesById,
  pulsingId,
  onSelect,
}: NeighborhoodLayerProps) {
  const layerRef = useRef<LeafletGeoJSON | null>(null);

  useEffect(() => {
    if (!map) return;

    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled) return;

      layerRef.current?.remove();

      const layer = L.geoJSON(
        neighborhoods.map((n) => ({
          type: "Feature" as const,
          properties: { id: n.id, name: n.name },
          geometry: n.geometry as GeoJSON.Geometry,
        })),
        {
          style: (feature) => {
            const level = levelsById[feature?.properties?.id] ?? "normal";
            return NEIGHBORHOOD_STYLES[level];
          },
          onEachFeature: (feature, layerInstance) => {
            const neighborhood = neighborhoods.find((n) => n.id === feature.properties.id);
            if (!neighborhood) return;

            const level = levelsById[feature.properties.id] ?? "normal";
            const label = hasRealName(neighborhood)
              ? neighborhood.name
              : citiesById[neighborhood.city_id]?.name ?? neighborhood.name;
            layerInstance.bindTooltip(`${label} — ${LEVEL_LABELS[level]}`);

            layerInstance.on("mouseover", () => {
              (layerInstance as Layer & { setStyle: (s: object) => void }).setStyle(
                NEIGHBORHOOD_HOVER_STYLE
              );
            });
            layerInstance.on("mouseout", () => {
              const currentLevel = levelsById[feature.properties.id] ?? "normal";
              (layerInstance as Layer & { setStyle: (s: object) => void }).setStyle(
                NEIGHBORHOOD_STYLES[currentLevel]
              );
            });
            layerInstance.on("click", () => onSelect(neighborhood));
          },
        }
      ).addTo(map);

      layerRef.current = layer;
    });

    return () => {
      cancelled = true;
      layerRef.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, neighborhoods, levelsById, citiesById]);

  useEffect(() => {
    if (!pulsingId || !layerRef.current) return;
    layerRef.current.eachLayer((layerInstance) => {
      const feature = (layerInstance as unknown as { feature: GeoJSON.Feature }).feature;
      if (feature?.properties?.id !== pulsingId) return;
      const el = (layerInstance as unknown as { getElement?: () => HTMLElement }).getElement?.();
      el?.classList.add("animate-pulse");
      setTimeout(() => el?.classList.remove("animate-pulse"), 1500);
    });
  }, [pulsingId]);

  return null;
}
