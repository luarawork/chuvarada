import cron from "node-cron";

// Agendador interno, só relevante se o deploy for num servidor persistente
// (Railway/Render) em vez de serverless (Vercel já tem cron nativo via
// vercel.json; Netlify via netlify/functions/scheduled-cron.mts) — nesses
// dois casos, ENABLE_INTERNAL_CRON deve ficar em "false"/ausente, senão o
// cron rodaria em duplicidade. Ativado via instrumentation.ts, que o
// Next.js chama uma única vez na subida do processo do servidor.
let started = false;

export function startInternalCron(): void {
  if (started) return;
  started = true;

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.warn("[internal-cron] CRON_SECRET não definido — agendador interno não iniciado");
    started = false;
    return;
  }

  cron.schedule("*/20 * * * *", async () => {
    try {
      const res = await fetch(`${appUrl}/api/cron/update`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      console.log(`[internal-cron] ciclo concluído: HTTP ${res.status}`);
    } catch (err) {
      console.error("[internal-cron] falha no ciclo:", (err as Error).message);
    }
  });

  console.log("[internal-cron] agendador interno ativo (a cada 20min)");
}
