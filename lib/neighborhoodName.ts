import type { Neighborhood } from "@/types";

const FALLBACK_NAME_PATTERN = /Setor|Distrito/i;

// Um bairro só tem nome de verdade se veio de NM_BAIRRO no Censo — os
// municípios pequenos do interior, sem bairro nomeado, caem no distrito
// administrativo inteiro (ou setor censitário, no fallback final) como
// aproximação geométrica. Mostrar esse nome como se fosse um bairro real
// engana o usuário sobre o que ele está vendo no mapa.
export function hasRealName(neighborhood: Pick<Neighborhood, "name" | "name_source">): boolean {
  if (neighborhood.name_source && neighborhood.name_source !== "bairro") return false;
  if (!neighborhood.name || neighborhood.name.trim() === "") return false;
  if (FALLBACK_NAME_PATTERN.test(neighborhood.name)) return false;
  return true;
}
