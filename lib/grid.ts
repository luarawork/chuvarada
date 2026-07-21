// Arredonda uma coordenada pra uma grade de ~10km, usada pra agrupar bairros
// próximos numa mesma "célula" de clima — em vez de buscar o clima 1x por
// cidade inteira (que ignora a variação real de chuva dentro dela, ex:
// Salvador e Natal têm bairros com chuva bem diferente entre si na mesma
// hora), busca 1x por célula e todo bairro dentro dela usa esse dado.
//
// Aumentado de 0,05° (~5km) pra 0,1° (~10km) antes da expansão nacional —
// dobrar a área coberta com a mesma resolução de grade dobraria também o
// número de células únicas e, com isso, o consumo de chamadas à Open-Meteo
// (ver lib/weather.ts, MAX_CALLS_PER_DAY) bem além da cota diária gratuita.
const GRID_SIZE_DEG = 0.1;

export interface GridCell {
  lat: number;
  lng: number;
}

export function gridCell(lat: number, lng: number): GridCell {
  return {
    lat: Math.round(lat / GRID_SIZE_DEG) * GRID_SIZE_DEG,
    lng: Math.round(lng / GRID_SIZE_DEG) * GRID_SIZE_DEG,
  };
}

export function gridCellKey(cell: GridCell): string {
  return `${cell.lat.toFixed(2)},${cell.lng.toFixed(2)}`;
}
