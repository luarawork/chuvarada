"use client";

import { useCallback, useState } from "react";
import type { Map as LeafletMap, LatLngBounds } from "leaflet";

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export const NORDESTE_BOUNDS: [[number, number], [number, number]] = [
  [-15, -45],
  [-1, -35],
];

export function useMap() {
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [bounds, setBounds] = useState<MapBounds | null>(null);

  const handleMapReady = useCallback((instance: LeafletMap) => {
    setMap(instance);
    updateBounds(instance.getBounds());

    instance.on("moveend", () => updateBounds(instance.getBounds()));
  }, []);

  function updateBounds(b: LatLngBounds) {
    setBounds({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    });
  }

  const flyTo = useCallback(
    (lat: number, lng: number, zoom = 14) => {
      map?.flyTo([lat, lng], zoom, { duration: 1.2 });
    },
    [map]
  );

  return { map, bounds, handleMapReady, flyTo };
}
