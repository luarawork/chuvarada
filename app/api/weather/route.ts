import { NextRequest, NextResponse } from "next/server";
import { getWeatherForPoint } from "@/lib/weather";
import { handleApiError } from "@/lib/apiError";

export async function GET(req: NextRequest) {
  const cityId = req.nextUrl.searchParams.get("cityId");
  const lat = req.nextUrl.searchParams.get("lat");
  const lng = req.nextUrl.searchParams.get("lng");

  if (!cityId || !lat || !lng) {
    return NextResponse.json(
      { error: "Parâmetros cityId, lat e lng são obrigatórios" },
      { status: 400 }
    );
  }

  try {
    const weather = await getWeatherForPoint(cityId, parseFloat(lat), parseFloat(lng));
    return NextResponse.json(weather);
  } catch (err) {
    return handleApiError(err, "api/weather");
  }
}
