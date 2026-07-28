import type { Pool } from "pg";

// Lock de execução compartilhado (tabela system_locks) -- antes triplicado
// com pequenas variações (isAlreadyRunning/acquireLock/releaseLock) nas 3
// rotas de cron (scores/weather/update), cada uma com sua própria chave e
// TTL. Protege contra 2 disparos do mesmo cron rodando ao mesmo tempo (ex:
// disparo manual enquanto o agendado já está no meio do ciclo) -- sem isso,
// 2 ciclos concorrentes dobrariam o consumo de cota das APIs de clima à toa
// e poderiam gravar risk_scores inconsistentes.
export interface LockOptions {
  key: string;
  lockedBy: string;
  maxAgeMinutes: number;
}

// Atômico: um único INSERT ... ON CONFLICT ... DO UPDATE ... WHERE ...
// RETURNING -- antes era um SELECT (isLocked) seguido de um INSERT
// separado (acquireLock), o que deixava uma janela de corrida entre as
// duas queries onde 2 chamadas quase simultâneas podiam ambas ver "sem
// lock" e ambas prosseguirem. A cláusula WHERE no DO UPDATE só deixa a
// atualização (e o RETURNING) acontecer quando o lock existente já
// expirou; um lock ainda válido faz o conflito virar no-op e a query
// não retorna linha nenhuma -- o Postgres serializa isso a nível de
// linha, então só uma chamada concorrente pode "vencer".
export async function acquireLock(db: Pool, options: LockOptions): Promise<boolean> {
  const { rows } = await db.query(
    `insert into system_locks (key, locked_at, locked_by) values ($1, now(), $2)
     on conflict (key) do update
       set locked_at = excluded.locked_at, locked_by = excluded.locked_by
       where system_locks.locked_at < now() - ($3 * interval '1 minute')
     returning key`,
    [options.key, options.lockedBy, options.maxAgeMinutes]
  );
  return rows.length > 0;
}

export async function releaseLock(db: Pool, key: string): Promise<void> {
  await db.query(`delete from system_locks where key = $1`, [key]);
}
