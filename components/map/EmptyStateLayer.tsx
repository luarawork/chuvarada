"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup, Path } from "leaflet";
import type { City } from "@/types";

interface EmptyStateLayerProps {
  map: LeafletMap | null;
  cities: City[];
  emptyCityIds: Set<string>;
}

// Municípios sem NENHUM bairro processado ainda (hoje: nenhum, mas a lista
// vem de uma checagem global -- ver /api/neighborhoods?emptyCities=true --
// em vez de inferir a partir dos bairros carregados no viewport atual, que
// faria toda cidade fora da tela parecer "vazia" incorretamente) ganham o
// polígono municipal real do IBGE (/geojson/empty_state_municipios.geojson)
// em vez de um marcador de ponto solto — visualmente consistente com os
// polígonos de bairro de verdade, sem sugerir uma área de risco calculada.
export function EmptyStateLayer({ map, cities, emptyCityIds }: EmptyStateLayerProps) {
  const groupRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const emptyCities = cities.filter((c) => emptyCityIds.has(c.id));

    if (emptyCities.length === 0) return;

    Promise.all([
      import("leaflet"),
      fetch("/geojson/empty_state_municipios.geojson").then((r) => r.json()),
    ]).then(([L, municipios]: [typeof import("leaflet"), GeoJSON.FeatureCollection]) => {
      if (cancelled) return;
      groupRef.current?.remove();

      const group = L.layerGroup();
      const style = {
        color: "rgba(100, 116, 139, 0.4)",
        weight: 1,
        fillColor: "rgba(100, 116, 139, 0.15)",
        fillOpacity: 1,
      };

      emptyCities.forEach((city) => {
        const feature = municipios.features.find((f) => f.properties?.name === city.name);
        if (!feature) return;

        const layer = L.geoJSON(feature, { style }).bindTooltip("Cobertura em expansão", {
          sticky: true,
        });

        layer.on("mouseover", (e) => (e.target as Path).setStyle({ fillOpacity: 0.3 }));
        layer.on("mouseout", (e) => (e.target as Path).setStyle({ fillOpacity: 1 }));

        layer.addTo(group);
      });

      group.addTo(map);
      groupRef.current = group;
    });

    return () => {
      cancelled = true;
      groupRef.current?.remove();
    };
  }, [map, cities, emptyCityIds]);

  return null;
}
