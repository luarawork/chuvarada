import * as turf from "@turf/turf";
import { gridCell, gridCellKey } from "./grid";
import type { City, Neighborhood } from "@/types";

// Cidades pequenas (a maioria) usam o centro da cidade como célula única de
// clima -- não há variação de chuva relevante entre bairros pra justificar
// sub-grade, e usar sempre o mesmo ponto colapsa a cidade inteira numa única
// chamada/leitura de clima. Só cidades grandes o bastante pra ter variação
// real (Salvador, Recife, Natal etc.) usam sub-grade por centroide de bairro.
// Extraído de app/api/cron/update/route.ts pra ser reaproveitado pelos crons
// A (scores) e B (weather) sem duplicar a lógica.
const LARGE_CITY_THRESHOLD = 10;

export interface CellGroup {
  lat: number;
  lng: number;
  neighborhoods: Neighborhood[];
}

export function groupNeighborhoodsByCell(city: Pick<City, "lat" | "lng">, neighborhoods: Neighborhood[]): CellGroup[] {
  const useSubGrid = neighborhoods.length > LARGE_CITY_THRESHOLD;
  const cellGroups = new Map<string, CellGroup>();

  for (const neighborhood of neighborhoods) {
    let lat: number;
    let lng: number;
    if (useSubGrid) {
      const centroid = turf.centroid(neighborhood.geometry as GeoJSON.Geometry);
      [lng, lat] = centroid.geometry.coordinates;
    } else {
      lat = city.lat;
      lng = city.lng;
    }
    const cell = gridCell(lat, lng);
    const key = gridCellKey(cell);

    if (!cellGroups.has(key)) {
      cellGroups.set(key, { lat: cell.lat, lng: cell.lng, neighborhoods: [] });
    }
    cellGroups.get(key)!.neighborhoods.push(neighborhood);
  }

  return Array.from(cellGroups.values());
}
