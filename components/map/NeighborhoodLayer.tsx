"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Layer } from "leaflet";
import { RISK_COLORS } from "@/lib/geojson";
import type { Neighborhood, RiskLevel } from "@/types";

interface NeighborhoodLayerProps {
  map: LeafletMap | null;
  neighborhoods: Neighborhood[];
  levelsById: Record<string, RiskLevel>;
  pulsingId?: string | null;
  onSelect: (neighborhood: Neighborhood) => void;
}

export function NeighborhoodLayer({
  map,
  neighborhoods,
  levelsById,
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
            return {
              color: RISK_COLORS[level],
              weight: 1,
              fillColor: RISK_COLORS[level],
              fillOpacity: 0.4,
            };
          },
          onEachFeature: (feature, layerInstance) => {
            const neighborhood = neighborhoods.find((n) => n.id === feature.properties.id);
            if (!neighborhood) return;

            layerInstance.bindTooltip(
              `${feature.properties.name} — ${levelsById[feature.properties.id] ?? "normal"}`
            );

            layerInstance.on("mouseover", () => {
              (layerInstance as Layer & { setStyle: (s: object) => void }).setStyle({
                fillOpacity: 0.7,
              });
            });
            layerInstance.on("mouseout", () => {
              (layerInstance as Layer & { setStyle: (s: object) => void }).setStyle({
                fillOpacity: 0.4,
              });
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
  }, [map, neighborhoods, levelsById]);

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
