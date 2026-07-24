import { NextRequest, NextResponse } from "next/server";
import { getCurrentTideLevel } from "@/lib/cptec";
import { handleApiError } from "@/lib/apiError";

export async function GET(req: NextRequest) {
  const cityId = req.nextUrl.searchParams.get("cityId");
  const tideCode = req.nextUrl.searchParams.get("tideCode");

  if (!cityId) {
    return NextResponse.json({ error: "Parâmetro cityId é obrigatório" }, { status: 400 });
  }

  try {
    const tide = await getCurrentTideLevel(cityId, tideCode);
    return NextResponse.json(tide);
  } catch (err) {
    return handleApiError(err, "api/tide");
  }
}
