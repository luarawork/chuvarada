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

// Nunca "normal" -- não empurramos notificação pra volta à normalidade, só
// pra piora de nível (ver notifyLevelChanges em lib/riskScoring.ts).
export type PushLevel = "attention" | "moderate" | "high" | "critical";

export interface PushPayload {
  title: string;
  body: string;
  icon: string;
  badge: string;
  url: string;
  level: PushLevel;
  neighborhoodId: string;
}

export async function sendPushNotification(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<void> {
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

// Formata a notificação de mudança de nível de risco pra um bairro. app_url
// deve vir sem barra final (ver process.env.APP_URL, já usado assim em
// outras partes do projeto).
//
// Rescala 2026-08-09: moderate/high são novos (antes só attention/critical
// existiam). Sem coluna de preferência própria pedida pro rollout (schema de
// push_subscriptions continua só com notify_on_attention/notify_on_critical,
// ver migração 036) -- moderate reusa o toggle de attention e high reusa o
// de critical em app/api/push/send/route.ts, preservando o comportamento
// "notifica em qualquer nível acima de normal" que já existia.
export function formatPushMessage(
  neighborhoodId: string,
  neighborhoodName: string,
  cityName: string,
  level: PushLevel,
  appUrl: string
): PushPayload {
  const messages: Record<PushLevel, { title: string; body: string }> = {
    attention: {
      title: `⚠️ Atenção — ${neighborhoodName}`,
      body: `${cityName} está em nível de atenção. Fique alerto.`,
    },
    moderate: {
      title: `🟠 Risco moderado — ${neighborhoodName}`,
      body: `${cityName} está em risco moderado de alagamento.`,
    },
    high: {
      title: `🔴 Risco alto — ${neighborhoodName}`,
      body: `${cityName} está em risco alto de alagamento. Evite áreas alagáveis.`,
    },
    critical: {
      title: `🟣 Risco crítico — ${neighborhoodName}`,
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
