import { config } from "./config";

interface DailySpend {
  dateUtc: string;
  totalUsdc: number;
}

let dailySpend: DailySpend = { dateUtc: todayUtc(), totalUsdc: 0 };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function rollover(): void {
  const today = todayUtc();
  if (dailySpend.dateUtc !== today) {
    dailySpend = { dateUtc: today, totalUsdc: 0 };
  }
}

export interface SafetyCheck {
  ok: boolean;
  reason?: string;
}

export function checkOrder(amountUsdc: number, maxPrice: number): SafetyCheck {
  rollover();
  if (!(amountUsdc > 0)) {
    return { ok: false, reason: "amountUsdc must be > 0" };
  }
  if (!(maxPrice > 0 && maxPrice < 1)) {
    return { ok: false, reason: "maxPrice must be between 0 and 1 (exclusive)" };
  }
  if (amountUsdc > config.safety.maxOrderUsdc) {
    return {
      ok: false,
      reason: `amountUsdc ${amountUsdc} exceeds per-order cap of ${config.safety.maxOrderUsdc} USDC`,
    };
  }
  if (dailySpend.totalUsdc + amountUsdc > config.safety.maxDailyUsdc) {
    return {
      ok: false,
      reason: `order would exceed daily cap of ${config.safety.maxDailyUsdc} USDC (spent today: ${dailySpend.totalUsdc})`,
    };
  }
  return { ok: true };
}

export function recordSpend(amountUsdc: number): void {
  rollover();
  dailySpend.totalUsdc += amountUsdc;
}

export function getDailySpend(): DailySpend {
  rollover();
  return { ...dailySpend };
}
