import { NextRequest, NextResponse } from "next/server";
import { getHistoricalPrecipitation, calculateDeviation } from "@/lib/climatology";
import { handleApiError } from "@/lib/apiError";

// Desvio da chuva de 72h atual em relação à média histórica do mesmo
// período do ano, pro bairro clicado no mapa (ver RiskFactors.tsx). Sem
// auth -- mesmo padrão de /api/tide e /api/weather, dado público derivado
// de coordenadas, não de usuário.
export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
  const rain72h = parseFloat(req.nextUrl.searchParams.get("rain72h") ?? "0");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat e lng obrigatórios" }, { status: 400 });
  }

  try {
    const climatology = await getHistoricalPrecipitation(lat, lng);
    if (!climatology) {
      return NextResponse.json({ error: "Dados históricos indisponíveis" }, { status: 503 });
    }

    const deviation = calculateDeviation(rain72h, climatology);

    return NextResponse.json(deviation, {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    return handleApiError(err, "api/climatology");
  }
}
