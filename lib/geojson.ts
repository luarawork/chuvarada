import * as turf from "@turf/turf";
import type { Neighborhood, RiskLevel } from "@/types";

export const RISK_COLORS: Record<RiskLevel, string> = {
  normal: "#2a9d72",
  attention: "#f0a500",
  critical: "#d64045",
};

// Bordas mais claras que o fill separam visualmente bairros vizinhos do
// mesmo nível de risco — um problema visível na Bahia, onde vários bairros
// adjacentes ficam no mesmo nível e o polígono antigo (fill=stroke, mesma
// opacidade) os fundia numa mancha só. Cores e opacidades separadas (em vez
// de rgba() já compostas) evitam a opacidade dobrar quando o hover soma seu
// próprio fillOpacity por cima.
export const NEIGHBORHOOD_STYLES: Record<
  RiskLevel,
  { fillColor: string; fillOpacity: number; color: string; opacity: number; weight: number }
> = {
  normal: { fillColor: "#2a9d72", fillOpacity: 0.35, color: "#2a9d72", opacity: 0.7, weight: 0.8 },
  attention: { fillColor: "#f0a500", fillOpacity: 0.4, color: "#f0a500", opacity: 0.75, weight: 0.8 },
  critical: { fillColor: "#d64045", fillOpacity: 0.45, color: "#d64045", opacity: 0.8, weight: 0.8 },
};

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
