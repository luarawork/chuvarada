// Hook oficial do Next.js, chamado uma única vez quando o processo do
// servidor sobe — usado aqui só pra ligar o agendador interno (lib/
// internalScheduler.ts) quando o deploy for num servidor persistente
// (Railway/Render). Em Vercel/Netlify (serverless), ENABLE_INTERNAL_CRON
// deve ficar "false"/ausente — cada requisição serverless roda em uma
// instância nova, então um node-cron ali só reagendaria repetidamente sem
// nunca completar um ciclo de 20min, além de duplicar o agendador nativo
// da plataforma (vercel.json / netlify/functions/scheduled-cron.mts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.ENABLE_INTERNAL_CRON === "true") {
    const { startInternalCron } = await import("./lib/internalScheduler");
    startInternalCron();
  }
}
