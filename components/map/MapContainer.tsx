"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, TileLayer } from "leaflet";
import { NORDESTE_BOUNDS } from "@/hooks/useMap";
import { TILE_LAYERS, type TileLayerKey } from "@/lib/constants";

interface MapContainerProps {
  tileLayer: TileLayerKey;
  onReady: (map: LeafletMap) => void;
  children?: React.ReactNode;
}

export function MapContainer({ tileLayer, onReady, children }: MapContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileLayerRef = useRef<TileLayer | null>(null);

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

      const initialLayer = TILE_LAYERS[tileLayer];
      tileLayerRef.current = L.tileLayer(initialLayer.url, {
        attribution: initialLayer.attribution,
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: "bottomright" }).addTo(map);

      mapRef.current = map;
      onReady(map);
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Troca a camada de tile em runtime (Modo Padrão <-> Modo Rua) -- remove a
  // anterior e adiciona uma nova em vez de mutar a existente (setUrl troca só
  // a URL, deixando attribution antiga presa no controle). Não roda antes do
  // mapa existir (guard abaixo) -- no mount, o efeito acima ainda está no meio
  // do import() assíncrono do Leaflet quando este roda pela primeira vez.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tileLayerRef.current) return;

    import("leaflet").then((L) => {
      if (!mapRef.current) return;
      tileLayerRef.current?.remove();
      const layer = TILE_LAYERS[tileLayer];
      tileLayerRef.current = L.tileLayer(layer.url, {
        attribution: layer.attribution,
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
    });
  }, [tileLayer]);

  return (
    <div ref={containerRef} className="absolute inset-0 h-full w-full">
      {children}
    </div>
  );
}
