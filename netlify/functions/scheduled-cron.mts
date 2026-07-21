// Dispara /api/cron/update sem esperar a resposta completa. Necessário
// porque funções agendadas do Netlify têm limite de 30s de execução (ver
// scripts/README_deploy_agendadores.md), mas o cron leva ~5min30s pra
// processar os 7.117 bairros — a mesma característica já observada em
// testes manuais desta sessão: o processo Next.js continua rodando o
// ciclo completo no servidor mesmo depois que o cliente desconecta. Por
// isso o timeout aqui é curto de propósito (a desconexão é esperada, não
// um erro real) — só precisamos garantir que a requisição foi *iniciada*.
export default async () => {
  const appUrl = process.env.APP_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!appUrl || !cronSecret) {
    console.error("[scheduled-cron] APP_URL ou CRON_SECRET não configurados");
    return new Response("Configuração ausente", { status: 500 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    await fetch(`${appUrl}/api/cron/update`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: controller.signal,
    });
    console.log("[scheduled-cron] cron disparado com sucesso (resposta completa)");
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.log("[scheduled-cron] cron disparado — desconectou após 25s por design, processamento continua no servidor");
    } else {
      console.error("[scheduled-cron] falha ao disparar o cron:", err);
    }
  } finally {
    clearTimeout(timeout);
  }

  return new Response("OK");
};

// Sem import de tipo do @netlify/functions de propósito — esse pacote não
// é dependência do projeto (o bundler de funções do Netlify resolve o
// shape de `config` em tempo de build, independente do nosso tsconfig).
export const config = {
  schedule: "0 * * * *",
};
