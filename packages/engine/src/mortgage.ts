import type { Mortgage } from "./types.ts";

/** Acquisition debt above this is not deductible (TCJA, made permanent); loans from before 2017-12-16 keep the $1M cap. */
export function acquisitionDebtCap(m: Mortgage): number {
  return m.originated <= "2017-12-15" ? 1_000_000 : 750_000;
}

function monthsBetween(fromIso: string, toYear: number): number {
  const from = new Date(fromIso + "T00:00:00Z");
  return (toYear - from.getUTCFullYear()) * 12 - from.getUTCMonth();
}

export interface MortgageYear {
  year: number;
  interestPaid: number;
  principalPaid: number;
  averageBalance: number;
  endingBalance: number;
  /** Share of interest on debt under the cap, 0..1. */
  capFraction: number;
}

/**
 * Amortize a mortgage from plan.startYear forward, one month at a time, with a fixed payment
 * computed from the remaining term. Interest is what the deduction is built on; the average
 * balance drives the acquisition-debt cap (Pub. 936's average-balance method, simplified).
 */
export function amortize(m: Mortgage, startYear: number, years: number): MortgageYear[] {
  const term = (m.termYears ?? 30) * 12;
  const elapsed = Math.max(0, monthsBetween(m.originated, startYear));
  const remaining = Math.max(1, term - elapsed);
  const i = m.rate / 12;
  const payment = i === 0 ? m.balance / remaining : (m.balance * i) / (1 - (1 + i) ** -remaining);
  const cap = acquisitionDebtCap(m);
  const overCap = (m.originalAmount ?? m.balance) > cap;
  const out: MortgageYear[] = [];
  let balance = m.balance;
  for (let y = 0; y < years; y++) {
    let interest = 0;
    let principal = 0;
    let balanceSum = 0;
    for (let mo = 0; mo < 12 && balance > 0.005; mo++) {
      const int = balance * i;
      const prin = Math.min(balance, payment - int);
      interest += int;
      principal += prin;
      balanceSum += balance;
      balance -= prin;
    }
    const average = balanceSum / 12;
    out.push({
      year: startYear + y,
      interestPaid: interest,
      principalPaid: principal,
      averageBalance: average,
      endingBalance: Math.max(0, balance),
      capFraction: overCap && average > 0 ? Math.min(1, cap / average) : 1,
    });
  }
  return out;
}
