import { NextRequest, NextResponse } from "next/server";
import { getWeatherForCity } from "@/lib/openweathermap";

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
    const weather = await getWeatherForCity(cityId, parseFloat(lat), parseFloat(lng));
    return NextResponse.json(weather);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
