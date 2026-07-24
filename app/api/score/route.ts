import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import { getServerSupabase } from "@/lib/supabase";
import { calculateScore } from "@/lib/score";
import { getWeatherForPoint } from "@/lib/weather";
import { getCurrentTideLevel } from "@/lib/cptec";
import { handleApiError } from "@/lib/apiError";
import type { City, Neighborhood } from "@/types";

export async function GET(req: NextRequest) {
  const neighborhoodId = req.nextUrl.searchParams.get("neighborhoodId");
  if (!neighborhoodId) {
    return NextResponse.json({ error: "Parâmetro neighborhoodId é obrigatório" }, { status: 400 });
  }

  const db = getServerSupabase();

  const { data: neighborhood, error: nError } = await db
    .from("neighborhoods")
    .select("*, cities(*)")
    .eq("id", neighborhoodId)
    .single();

  if (nError || !neighborhood) {
    return NextResponse.json({ error: "Bairro não encontrado" }, { status: 404 });
  }

  const city = neighborhood.cities as City;
  const n = neighborhood as Neighborhood;

  try {
    const centroid = turf.centroid(n.geometry as GeoJSON.Geometry);
    const [centroidLng, centroidLat] = centroid.geometry.coordinates;
    const weather = await getWeatherForPoint(city.id, centroidLat, centroidLng);
    const tide = await getCurrentTideLevel(city.id, city.tide_code);
    const result = calculateScore(n, weather, tide.level);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err, "api/score");
  }
}
