import cron from "node-cron";

// Agendador interno, alternativa ao GitHub Actions (mecanismo decidido do
// projeto, ver scripts/SETUP_ACTIONS.md) só pra deploy num servidor
// persistente (Railway/Render) sem acesso a Actions. Com os workflows do
// GitHub configurados, ENABLE_INTERNAL_CRON deve ficar em "false"/ausente,
// senão o cron rodaria em duplicidade. Ativado via instrumentation.ts, que
// o Next.js chama uma única vez na subida do processo do servidor.
//
// Nota: este agendador chama /api/cron/update (o cron único original), não
// os 2 cronos separados que o GitHub Actions usa hoje (/api/cron/scores +
// /api/cron/weather) — ver o aviso de depreciação no topo de
// app/api/cron/update/route.ts antes de reativar isso em produção.
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

  cron.schedule("0 * * * *", async () => {
    try {
      const res = await fetch(`${appUrl}/api/cron/update`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      console.log(`[internal-cron] ciclo concluído: HTTP ${res.status}`);
    } catch (err) {
      console.error("[internal-cron] falha no ciclo:", (err as Error).message);
    }
  });

  console.log("[internal-cron] agendador interno ativo (a cada 1h)");
}
