import { NextRequest, NextResponse } from "next/server";
import { fetchForecastDisplay } from "@/lib/weather";
import { handleApiError } from "@/lib/apiError";

// Previsão do tempo (atual + próximas ~12h) pro painel de detalhe do bairro.
// Não passa por cache/tabela — só usado quando o usuário abre um bairro.
export async function GET(req: NextRequest) {
  const lat = req.nextUrl.searchParams.get("lat");
  const lng = req.nextUrl.searchParams.get("lng");

  if (!lat || !lng) {
    return NextResponse.json({ error: "Parâmetros lat e lng são obrigatórios" }, { status: 400 });
  }

  try {
    const forecast = await fetchForecastDisplay(parseFloat(lat), parseFloat(lng));
    return NextResponse.json(forecast);
  } catch (err) {
    return handleApiError(err, "api/forecast");
  }
}
