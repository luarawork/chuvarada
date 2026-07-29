// Worker customizado compilado e importado no service worker gerado pelo
// next-pwa (customWorkerDir padrão = "worker", ver next.config.mjs) --
// adiciona os listeners de push notification que o Workbox/GenerateSW não
// gera sozinho. Ver lib/webpush.ts pro formato do payload enviado por
// app/api/push/send.
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const payload = event.data.json();

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      data: { url: payload.url },
      vibrate: [200, 100, 200],
      tag: `chuvarada-${payload.neighborhoodId}`, // agrupa notificações do mesmo bairro
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
