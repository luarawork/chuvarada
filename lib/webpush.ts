import webpush from "web-push";

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  icon: string;
  badge: string;
  url: string;
  level: "attention" | "critical";
  neighborhoodId: string;
}

export async function sendPushNotification(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<void> {
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

// Formata a notificação de mudança de nível de risco pra um bairro. app_url
// deve vir sem barra final (ver process.env.APP_URL, já usado assim em
// outras partes do projeto).
export function formatPushMessage(
  neighborhoodId: string,
  neighborhoodName: string,
  cityName: string,
  level: "attention" | "critical",
  appUrl: string
): PushPayload {
  const messages = {
    attention: {
      title: `⚠️ Atenção — ${neighborhoodName}`,
      body: `${cityName} está em nível de atenção. Fique alerto.`,
    },
    critical: {
      title: `🔴 Risco crítico — ${neighborhoodName}`,
      body: `${cityName} está em risco crítico de alagamento agora.`,
    },
  };

  return {
    ...messages[level],
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    url: `${appUrl}/?bairro=${encodeURIComponent(neighborhoodName)}`,
    level,
    neighborhoodId,
  };
}
