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

export async function isLocked(db: Pool, key: string, maxAgeMinutes: number): Promise<boolean> {
  const { rows } = await db.query(`select locked_at from system_locks where key = $1`, [key]);
  const lockRow = rows[0];
  if (!lockRow) return false;
  const ageMinutes = (Date.now() - new Date(lockRow.locked_at).getTime()) / 60000;
  return ageMinutes < maxAgeMinutes;
}

export async function acquireLock(db: Pool, options: Pick<LockOptions, "key" | "lockedBy">): Promise<void> {
  await db.query(
    `insert into system_locks (key, locked_at, locked_by) values ($1, now(), $2)
     on conflict (key) do update set locked_at = excluded.locked_at, locked_by = excluded.locked_by`,
    [options.key, options.lockedBy]
  );
}

export async function releaseLock(db: Pool, key: string): Promise<void> {
  await db.query(`delete from system_locks where key = $1`, [key]);
}
