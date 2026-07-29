import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// PushManager.subscribe() exige applicationServerKey como BufferSource, não
// string -- a chave pública VAPID vem em base64url (RFC 4648 §5, os únicos
// caracteres compatíveis com URL: '-' e '_' no lugar de '+' e '/').
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(rawData.split("").map((char) => char.charCodeAt(0)));
}

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
    setIsSupported(supported);
    if (!supported) return;

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setIsSubscribed(subscription !== null))
      .catch(() => {});
  }, []);

  async function subscribe(neighborhoodIds: string[]) {
    setIsLoading(true);
    setError(null);
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Notificações push não configuradas neste ambiente.");

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ subscription: subscription.toJSON(), neighborhoodIds }),
      });
      if (!res.ok) throw new Error("Falha ao salvar a inscrição de notificações.");

      setIsSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao ativar notificações.");
    } finally {
      setIsLoading(false);
    }
  }

  async function unsubscribe() {
    setIsLoading(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao desativar notificações.");
    } finally {
      setIsLoading(false);
    }
  }

  return { isSupported, isSubscribed, isLoading, error, subscribe, unsubscribe };
}
