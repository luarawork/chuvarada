import { Pool } from "pg";

// Conexão direta ao Postgres do Supabase, usada só em código server-side
// (API routes / cron). Bypassa RLS — necessário porque cities/neighborhoods/
// risk_scores/risk_events/tide_cache/weather_cache só têm policy de leitura
// pública, sem policy de insert/update para a anon key, e não há uma
// SUPABASE_SERVICE_ROLE_KEY configurada para o cliente supabase-js.
let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    const connectionString = process.env.SUPABASE_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("SUPABASE_CONNECTION_STRING não definida");
    }
    // max maior que o default (10) porque o cron agora processa cidades em
    // paralelo (~1800 cidades ativas desde a expansão pro Nordeste inteiro) —
    // com o default, a concorrência do cron ficava presa esperando conexão
    // livre em vez de aproveitar o paralelismo de fato.
    //
    // connectionTimeoutMillis: sem isso, o `pg` não tem timeout próprio pra
    // connect() e cai no timeout do SO -- medido em ~20-21s neste ambiente
    // pra uma conexão que vai cair na rota IPv6 instável até o Supabase (ver
    // docs/relatorio_vulnerabilidades.md). Isso fazia CADA tentativa de
    // conexão nova que caísse nessa janela travar a requisição inteira por
    // 20s, e o retry do frontend (app/page.tsx) podia empilhar até 3x isso
    // no pior caso -- essa era a causa real do "carregamento muito lento"
    // dos polígonos, não as queries (sub-40ms, índices usados normalmente)
    // nem o tamanho do payload. 5s é generoso o bastante pra uma conexão
    // saudável (round-trip real observado bem abaixo disso) e ainda assim
    // corta o pior caso de 20s pra 5s por tentativa.
    //
    // idleTimeoutMillis: default do pg é 10s -- baixo demais pro padrão de
    // uso real (usuário navegando o mapa em rajadas, com pausas entre
    // movimentos). Subir pra 30s mantém conexões già estabelecidas vivas
    // por mais tempo entre requisições, reduzindo quantas vezes uma conexão
    // NOVA (e portanto sujeita à rota instável) precisa ser aberta.
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 15,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}
