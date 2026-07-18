"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { City, Neighborhood } from "@/types";

interface EmptyStateLayerProps {
  map: LeafletMap | null;
  cities: City[];
  neighborhoods: Neighborhood[];
}

// Só marca cidades que ainda não têm NENHUM bairro processado (hoje: São
// Luís). Cidades com cobertura parcial (Fortaleza, Maceió, Aracaju, João
// Pessoa) já têm bairros de verdade coloridos no mapa — um ponto amarelo
// solto por cima deles só confundia, sem explicar nada (daí a legenda em
// components/ui/MapLegend.tsx).
export function EmptyStateLayer({ map, cities, neighborhoods }: EmptyStateLayerProps) {
  const groupRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const citiesWithNeighborhoods = new Set(neighborhoods.map((n) => n.city_id));
    const emptyCities = cities.filter((c) => !citiesWithNeighborhoods.has(c.id));

    import("leaflet").then((L) => {
      if (cancelled) return;
      groupRef.current?.remove();

      const group = L.layerGroup();

      emptyCities.forEach((city) => {
        const isCoastal = city.tide_code !== null;
        const tooltip = isCoastal
          ? "Ainda sem bairros processados — em expansão"
          : "Ainda sem bairros processados — cidade não costeira, sem dado de maré";

        const marker = L.circleMarker([city.lat, city.lng], {
          radius: 7,
          color: "#4a5568",
          fillColor: "#4a5568",
          fillOpacity: 0.5,
          weight: 1.5,
          dashArray: "3,3",
        }).bindTooltip(`${city.name}: ${tooltip}`);

        marker.addTo(group);
      });

      group.addTo(map);
      groupRef.current = group;
    });

    return () => {
      cancelled = true;
      groupRef.current?.remove();
    };
  }, [map, cities, neighborhoods]);

  return null;
}
