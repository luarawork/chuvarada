// Hook oficial do Next.js, chamado uma única vez quando o processo do
// servidor sobe — usado aqui só pra ligar o agendador interno (lib/
// internalScheduler.ts), uma alternativa pra deploy num servidor
// persistente (Railway/Render) sem GitHub Actions. O mecanismo decidido e
// validado do projeto é o GitHub Actions (ver .github/workflows/ e
// docs/SETUP_ACTIONS.md) — ENABLE_INTERNAL_CRON deve ficar
// "false"/ausente sempre que os workflows estiverem configurados, senão
// o cron roda em duplicidade. Em serverless (Vercel/Netlify), nem faz
// sentido ativar: cada requisição roda numa instância nova, então um
// node-cron ali só reagendaria repetidamente sem nunca completar um ciclo.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.ENABLE_INTERNAL_CRON === "true") {
    const { startInternalCron } = await import("./lib/internalScheduler");
    startInternalCron();
  }
}
