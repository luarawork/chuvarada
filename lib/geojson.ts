import * as turf from "@turf/turf";
import type { Neighborhood, RiskLevel } from "@/types";
import { RISK_COLORS } from "@/lib/constants";

// Re-exportado -- lib/constants.ts é a fonte única (ver
// docs/reports/revisao_qualidade.md, achado 🟡 #4); mantido aqui também porque
// lib/geojson.ts é onde outros helpers de mapa/risco já vivem.
export { RISK_COLORS };

// Bordas mais claras que o fill separam visualmente bairros vizinhos do
// mesmo nível de risco — um problema visível na Bahia, onde vários bairros
// adjacentes ficam no mesmo nível e o polígono antigo (fill=stroke, mesma
// opacidade) os fundia numa mancha só. Cores e opacidades separadas (em vez
// de rgba() já compostas) evitam a opacidade dobrar quando o hover soma seu
// próprio fillOpacity por cima. fillColor/color derivados de RISK_COLORS
// (não mais hex duplicado aqui) -- só fillOpacity/opacity/weight variam
// por nível.
const NEIGHBORHOOD_FILL_OPACITY: Record<RiskLevel, number> = {
  normal: 0.35,
  attention: 0.4,
  moderate: 0.45,
  high: 0.5,
  critical: 0.55,
};
const NEIGHBORHOOD_STROKE_OPACITY: Record<RiskLevel, number> = {
  normal: 0.7,
  attention: 0.75,
  moderate: 0.8,
  high: 0.85,
  critical: 0.9,
};

export const NEIGHBORHOOD_STYLES: Record<
  RiskLevel,
  { fillColor: string; fillOpacity: number; color: string; opacity: number; weight: number }
> = (Object.keys(RISK_COLORS) as RiskLevel[]).reduce(
  (acc, level) => {
    acc[level] = {
      fillColor: RISK_COLORS[level],
      fillOpacity: NEIGHBORHOOD_FILL_OPACITY[level],
      color: RISK_COLORS[level],
      opacity: NEIGHBORHOOD_STROKE_OPACITY[level],
      weight: 0.8,
    };
    return acc;
  },
  {} as Record<RiskLevel, { fillColor: string; fillOpacity: number; color: string; opacity: number; weight: number }>
);

export const NEIGHBORHOOD_HOVER_STYLE = { fillOpacity: 0.65, weight: 1.5 };

export function neighborhoodToFeature(
  neighborhood: Neighborhood,
  level: RiskLevel | null
): GeoJSON.Feature {
  return turf.feature(neighborhood.geometry as GeoJSON.Geometry, {
    id: neighborhood.id,
    name: neighborhood.name,
    city_id: neighborhood.city_id,
    level: level ?? "normal",
    is_coastal: neighborhood.is_coastal,
  });
}

// Filtra bairros cujo centróide cai dentro dos bounds visíveis do mapa.
export function neighborhoodsInBounds(
  neighborhoods: Neighborhood[],
  bounds: { north: number; south: number; east: number; west: number }
): Neighborhood[] {
  return neighborhoods.filter((n) => {
    const centroid = turf.centroid(n.geometry as GeoJSON.Geometry);
    const [lng, lat] = centroid.geometry.coordinates;
    return (
      lat <= bounds.north && lat >= bounds.south && lng <= bounds.east && lng >= bounds.west
    );
  });
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return turf.distance(turf.point([lng1, lat1]), turf.point([lng2, lat2]), { units: "kilometers" });
}
