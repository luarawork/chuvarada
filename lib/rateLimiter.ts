// Contador diário reutilizável, extraído do que já existia duplicado em
// lib/weather.ts (Open-Meteo) e lib/weatherapi.ts (WeatherAPI) -- agora que
// a estratégia de fallback em camadas precisa checar "está esgotado?" ANTES
// de tentar uma chamada (em vez de só descobrir via exceção no meio de um
// retry loop), os dois precisam do mesmo formato de contador. Reseta à
// meia-noite UTC; avisa no log ao atingir 80% e ao ser esgotado (100%).
export interface RateLimiterStats {
  label: string;
  callsToday: number;
  limit: number;
  percentage: number;
  status: "standby" | "ok" | "warning" | "exhausted";
}

// `Number(process.env.X) || default` parece razoável mas tem um bug real
// com "0": 0 é falsy em JS, então `0 || default` silenciosamente devolve o
// default em vez do 0 explicitamente pedido -- descoberto testando o
// próprio fallback em camadas desta sessão (setar um teto "0" pra simular
// esgotamento total não tinha efeito nenhum, e a chamada ainda ia pra API
// real). Corrige checando undefined/NaN em vez de falsy.
export function envIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class DailyRateLimiter {
  private readonly limit: number;
  private readonly label: string;
  private readonly warnAtPercent: number;
  private currentUtcDay: string;
  private callsToday = 0;
  private warned80 = false;
  private warned100 = false;

  constructor(limit: number, label: string, warnAtPercent = 0.8) {
    this.limit = limit;
    this.label = label;
    this.warnAtPercent = warnAtPercent;
    this.currentUtcDay = utcDateString(new Date());
  }

  private rolloverIfNeeded(): void {
    const today = utcDateString(new Date());
    if (today !== this.currentUtcDay) {
      this.currentUtcDay = today;
      this.callsToday = 0;
      this.warned80 = false;
      this.warned100 = false;
    }
  }

  isExhausted(): boolean {
    this.rolloverIfNeeded();
    return this.callsToday >= this.limit;
  }

  // Incrementa e avisa nos limiares -- não lança erro sozinho; quem chama
  // decide o que fazer com isExhausted() antes de tentar a chamada real.
  increment(): void {
    this.rolloverIfNeeded();
    this.callsToday++;
    const warnThreshold = Math.floor(this.limit * this.warnAtPercent);
    if (!this.warned80 && this.callsToday >= warnThreshold) {
      console.warn(
        `[rateLimiter] ${this.label}: ${this.callsToday} de ${this.limit} chamadas diárias usadas ` +
          `(${Math.round(this.warnAtPercent * 100)}%) — aproximando do limite diário.`
      );
      this.warned80 = true;
    }
    if (!this.warned100 && this.callsToday >= this.limit) {
      console.warn(`[rateLimiter] ${this.label}: limite de ${this.limit} chamadas/dia atingido — pausando até a meia-noite UTC.`);
      this.warned100 = true;
    }
  }

  getStats(): RateLimiterStats {
    this.rolloverIfNeeded();
    const percentage = Math.round((this.callsToday / this.limit) * 100);
    const status: RateLimiterStats["status"] =
      this.callsToday >= this.limit
        ? "exhausted"
        : percentage >= this.warnAtPercent * 100
          ? "warning"
          : this.callsToday === 0
            ? "standby"
            : "ok";
    return { label: this.label, callsToday: this.callsToday, limit: this.limit, percentage, status };
  }
}
