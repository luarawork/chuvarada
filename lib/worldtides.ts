// Estrutura da integração com a WorldTides API (worldtides.info) -- PENDENTE:
// aguardando a criação da conta e da chave (WORLDTIDES_API_KEY) antes de
// implementar a chamada de verdade. Ver docs de pesquisa desta rodada e a
// Wiki (APIs.md) pro comparativo completo de fontes de maré consideradas.
//
// Por que essa fonte: CPTEC/Marinha (lib/cptec.ts) está fora do ar desde
// 22/07/2026 -- o app hoje usa fallback neutro (0.5) pra maré em toda cidade
// costeira. WorldTides cobre o Brasil inteiro por interpolação harmônica
// (não depende de uma lista fixa de 22 estações), tem API REST documentada
// e self-service, e como maré é previsão astronômica (não precisa refresh
// diário), o custo real pras ~22 cidades costeiras do projeto é baixo --
// ~44-88 créditos/semana, dentro do plano pago mais barato (~$4,99/mês,
// 20.000 créditos). O free tier atual é 100 créditos ÚNICOS (não 10/dia como
// versões antigas da documentação sugeriam) -- suficiente só pra testar a
// integração, não pra rodar em produção continuamente.
//
// Endpoint confirmado (docs oficiais, worldtides.info/apidocs, verificado
// nesta sessão): base https://www.worldtides.info/api/v3, autenticação via
// query param `key`. Pra altura de maré normalizada precisamos de 2 tipos de
// dado na mesma chamada:
//   - `heights=` -- série de alturas (metros) num intervalo de tempo, campos
//     de resposta: dt (timestamp unix), date, height (metros).
//   - `datums=` -- referências verticais (MLLW, MHHW, etc, todas de uma vez,
//     1 crédito), campos: name, height (metros) -- usadas pra normalizar a
//     altura absoluta numa escala 0-1 comparável entre estações diferentes.
//   - `extremes=` opcional, pra saber a próxima maré alta/baixa (campos:
//     dt, date, height, type: "High"/"Low") -- não essencial pro nível
//     atual, mas útil se quisermos mostrar "próxima maré alta em Xh" na UI
//     futuramente.
// Parâmetros de localização: `lat`/`lon` (não precisa de estação fixa -- ao
// contrário do CPTEC, que exigia um tide_code por porto).

export const WORLDTIDES_API_URL = "https://www.worldtides.info/api/v3";
const API_KEY = process.env.WORLDTIDES_API_KEY;

export interface TideHeightPoint {
  dt: number; // timestamp unix
  date: string;
  height: number; // metros
}

export interface TideExtremePoint extends TideHeightPoint {
  type: "High" | "Low";
}

export interface TideDatum {
  name: string; // ex: "MLLW", "MHHW", "MSL"
  height: number; // metros
}

export interface WorldTidesResponse {
  status: number;
  error?: string;
  callCount: number;
  requestLat: number;
  requestLon: number;
  heights?: TideHeightPoint[];
  extremes?: TideExtremePoint[];
  datums?: TideDatum[];
}

// Normaliza uma altura de maré absoluta (metros, referência MSL/CD conforme
// a chamada) pra escala 0-1 usando os datums MLLW (maré baixa média) e MHHW
// (maré alta média) da própria estação -- necessário porque a altura
// absoluta não é comparável entre portos com amplitudes de maré diferentes.
export function normalizeTideHeight(currentHeight: number, mllw: number, mhhw: number): number {
  if (mhhw <= mllw) return 0.5; // datums inválidos/iguais -- evita divisão por zero, cai pro neutro
  return Math.max(0, Math.min(1, (currentHeight - mllw) / (mhhw - mllw)));
}

// Busca o nível de maré atual pra uma coordenada, já normalizado (0-1).
// NÃO IMPLEMENTADO ainda -- aguardando WORLDTIDES_API_KEY. Quando a chave
// estiver disponível, isso deve: 1) chamar a API com heights+datums pro
// lat/lng pedido (step curto o bastante pra pegar a hora atual, 1 dia
// basta); 2) achar o ponto de `heights` mais próximo de "agora"; 3) achar
// os datums MLLW/MHHW na resposta; 4) normalizar com normalizeTideHeight().
export async function getCurrentTideLevel(lat: number, lng: number): Promise<number> {
  if (!API_KEY) {
    throw new Error("WORLDTIDES_API_KEY não configurada");
  }
  throw new Error(
    `getCurrentTideLevel (WorldTides) ainda não implementado -- só a estrutura existe por ora (lat=${lat}, lng=${lng})`
  );
}
