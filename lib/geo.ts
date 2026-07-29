// Corrige achados médios M8/M10 da auditoria de segurança (24/07/2026,
// docs/reports/relatorio_vulnerabilidades.md): validação de state (UF) e de
// bbox, compartilhada entre os endpoints que recebem esses parâmetros.
export const BRAZIL_STATES = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

export function isValidBrazilState(value: string | null): boolean {
  return !!value && /^[A-Z]{2}$/.test(value) && BRAZIL_STATES.includes(value);
}

// Agrupamento oficial do IBGE por região -- usado no filtro de /analise pra
// permitir "Brasil inteiro" e as 5 regiões além de UF individual.
export const BRAZIL_REGIONS: Record<string, string[]> = {
  norte: ["AM", "PA", "RR", "AP", "AC", "RO", "TO"],
  nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  sudeste: ["SP", "RJ", "MG", "ES"],
  sul: ["PR", "SC", "RS"],
  "centro-oeste": ["GO", "MT", "MS", "DF"],
};

// Resolve o valor de ?region= (ou ?state= como fallback, pro contrato antigo
// de UF única continuar funcionando) pra lista de UFs a consultar. "BR"
// devolve o país inteiro, uma chave de BRAZIL_REGIONS devolve os estados
// daquela região, e uma UF de 2 letras devolve ela mesma numa lista de 1.
// Retorna null se o valor não for reconhecido em nenhum desses 3 formatos.
export function resolveStatesFilter(value: string | null): string[] | null {
  if (!value) return null;
  if (value === "BR") return BRAZIL_STATES;
  if (BRAZIL_REGIONS[value]) return BRAZIL_REGIONS[value];
  if (isValidBrazilState(value)) return [value];
  return null;
}

export interface Bbox {
  north: number;
  south: number;
  east: number;
  west: number;
}

// O bbox do Brasil inteiro (extremos aprox. 5.27N/-33.75S/-34.79E/-73.99W,
// usado no modo heatmap com zoom bem afastado) já tem ~1.530 graus² de
// área -- um teto de 100 (o valor "óbvio" pra uma checagem de sanidade)
// rejeitaria esse caso de uso real. 10.000 deixa margem confortável pra
// qualquer viewport realista (inclusive um pouco além do território
// nacional) e ainda rejeita um bbox absurdo tipo o planeta inteiro
// (north=90/south=-90/east=180/west=-180 dá 64.800).
const MAX_BBOX_AREA_DEGREES = 10_000;

function parseBboxParam(value: string | null, min: number, max: number): number | null {
  const n = parseFloat(value ?? "");
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// Devolve null se algum parâmetro faltar/for inválido, OU se o bbox for
// maior que o razoável -- quem chama decide a mensagem de erro exata.
export function parseBbox(searchParams: URLSearchParams): Bbox | null {
  const north = parseBboxParam(searchParams.get("north"), -90, 90);
  const south = parseBboxParam(searchParams.get("south"), -90, 90);
  const east = parseBboxParam(searchParams.get("east"), -180, 180);
  const west = parseBboxParam(searchParams.get("west"), -180, 180);
  if (north === null || south === null || east === null || west === null) return null;
  if ((north - south) * (east - west) > MAX_BBOX_AREA_DEGREES) return null;
  return { north, south, east, west };
}
