import * as turf from "@turf/turf";
import type { Neighborhood, RiskLevel } from "@/types";

export const RISK_COLORS: Record<RiskLevel, string> = {
  normal: "#2a9d72",
  attention: "#f0a500",
  critical: "#d64045",
};

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

// Encontra o bairro cujo polígono contém o ponto do usuário (localização por GPS).
export function findNeighborhoodAtPoint(
  neighborhoods: Neighborhood[],
  lat: number,
  lng: number
): Neighborhood | null {
  const point = turf.point([lng, lat]);
  for (const n of neighborhoods) {
    const geometry = n.geometry as GeoJSON.Geometry;
    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      if (turf.booleanPointInPolygon(point, geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon)) {
        return n;
      }
    }
  }
  return null;
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return turf.distance(turf.point([lng1, lat1]), turf.point([lng2, lat2]), { units: "kilometers" });
}
