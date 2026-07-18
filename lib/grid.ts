// Arredonda uma coordenada pra uma grade de ~5km, usada pra agrupar bairros
// próximos numa mesma "célula" de clima — em vez de buscar o clima 1x por
// cidade inteira (que ignora a variação real de chuva dentro dela, ex:
// Salvador e Natal têm bairros com chuva bem diferente entre si na mesma
// hora), busca 1x por célula e todo bairro dentro dela usa esse dado.
const GRID_SIZE_DEG = 0.05;

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
