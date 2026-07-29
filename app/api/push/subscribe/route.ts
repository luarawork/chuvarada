import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUserIdFromAuthHeader } from "@/lib/auth";
import { rejectIfPayloadTooLarge, handleApiError } from "@/lib/apiError";

const MAX_NEIGHBORHOOD_IDS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Salva (ou atualiza) a subscription de push do browser -- exige usuário
// autenticado porque a subscription é sempre atrelada a favoritos de um
// usuário (neighborhood_ids), diferente de user_reports que aceita relato
// anônimo.
export async function POST(req: NextRequest) {
  const tooLarge = rejectIfPayloadTooLarge(req);
  if (tooLarge) return tooLarge;

  const userId = await getUserIdFromAuthHeader(req.headers.get("Authorization"));
  if (!userId) {
    return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const { subscription, neighborhoodIds } = body;
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;

  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    return NextResponse.json({ error: "subscription inválida" }, { status: 400 });
  }

  const ids = Array.isArray(neighborhoodIds) ? neighborhoodIds : [];
  if (ids.length > MAX_NEIGHBORHOOD_IDS || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return NextResponse.json({ error: "neighborhoodIds inválido" }, { status: 400 });
  }

  try {
    const db = getDb();
    await db.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth, neighborhood_ids, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (endpoint) do update set
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         neighborhood_ids = excluded.neighborhood_ids,
         updated_at = now()`,
      [userId, endpoint, p256dh, auth, ids]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "push/subscribe");
  }
}

// Remove a subscription (usuário desativou notificações neste browser).
export async function DELETE(req: NextRequest) {
  const userId = await getUserIdFromAuthHeader(req.headers.get("Authorization"));
  if (!userId) {
    return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string") {
    return NextResponse.json({ error: "endpoint inválido" }, { status: 400 });
  }

  try {
    const db = getDb();
    await db.query("delete from push_subscriptions where endpoint = $1 and user_id = $2", [endpoint, userId]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "push/subscribe");
  }
}
