import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth";
import { rejectIfPayloadTooLarge, handleApiError } from "@/lib/apiError";
import { sendPushNotification, formatPushMessage } from "@/lib/webpush";

// Chamado pelo Cron A (app/api/cron/scores/route.ts) quando um bairro muda
// de nível pra atenção/crítico -- ver seção 3.8. Protegido pelo CRON_SECRET,
// não é um endpoint de uso do frontend.
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("Authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const tooLarge = rejectIfPayloadTooLarge(req);
  if (tooLarge) return tooLarge;

  const body = await req.json().catch(() => null);
  const { neighborhoodId, level, neighborhoodName, cityName } = body ?? {};

  if (
    typeof neighborhoodId !== "string" ||
    (level !== "attention" && level !== "critical") ||
    typeof neighborhoodName !== "string" ||
    typeof cityName !== "string"
  ) {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const appUrl = process.env.APP_URL ?? "https://chuvarada.vercel.app";
  const column = level === "critical" ? "notify_on_critical" : "notify_on_attention";

  try {
    const db = getDb();
    const { rows: subscriptions } = await db.query(
      `select endpoint, p256dh, auth from push_subscriptions
       where neighborhood_ids @> array[$1]::uuid[] and ${column} = true`,
      [neighborhoodId]
    );

    if (subscriptions.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const payload = formatPushMessage(neighborhoodId, neighborhoodName, cityName, level, appUrl);
    let sent = 0;
    const failed: string[] = [];

    for (const sub of subscriptions) {
      try {
        await sendPushNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        sent++;
      } catch (err) {
        // 410 Gone -- subscription expirada/revogada pelo browser, remove do banco.
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 410) {
          await db.query("delete from push_subscriptions where endpoint = $1", [sub.endpoint]);
        }
        failed.push(sub.endpoint);
      }
    }

    return NextResponse.json({ ok: true, sent, failed: failed.length });
  } catch (err) {
    return handleApiError(err, "push/send");
  }
}
