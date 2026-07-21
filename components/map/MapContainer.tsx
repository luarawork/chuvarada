"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { NORDESTE_BOUNDS } from "@/hooks/useMap";

const DARK_TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const DARK_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

interface MapContainerProps {
  onReady: (map: LeafletMap) => void;
  children?: React.ReactNode;
}

export function MapContainer({ onReady, children }: MapContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        // Canvas em vez do SVG padrão do Leaflet -- com milhares de
        // polígonos de bairro num viewport largo, SVG cria um <path> por
        // feature (DOM pesado pra estilizar/repintar); Canvas desenha tudo
        // numa única superfície de bitmap, bem mais rápido nesse volume.
        preferCanvas: true,
      }).fitBounds(NORDESTE_BOUNDS);

      L.tileLayer(DARK_TILE_URL, {
        attribution: DARK_TILE_ATTRIBUTION,
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: "bottomleft" }).addTo(map);

      mapRef.current = map;
      onReady(map);
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 h-full w-full">
      {children}
    </div>
  );
}
