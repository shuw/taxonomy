import { sharesExercisable } from "./equity.ts";
import { resolveLevers, runPlan } from "./plan.ts";
import type { Levers, Profile } from "./types.ts";

export interface AmtCrossover {
  year: number;
  /** ISO shares exercisable in this year given vesting and earlier years' exercises. */
  available: number;
  /** Largest number of ISO shares exercisable this year with zero AMT (holding other years fixed). */
  sharesBeforeAmt: number;
  /** Whether the current lever position is already past the crossover. */
  overCrossover: boolean;
}

const withIso = (levers: Levers, year: number, shares: number): Partial<Levers> => ({
  exercises: { iso: { ...levers.exercises.iso, [year]: shares }, nso: levers.exercises.nso },
});

/** Binary-search the ISO exercise count in `year` at which AMT first appears. */
export function amtCrossover(profile: Profile, leverOverrides: Partial<Levers> | undefined, year: number): AmtCrossover {
  const levers = resolveLevers(profile, leverOverrides);
  const available = sharesExercisable(profile, levers, "iso", year);
  const amtAt = (shares: number): number => runPlan(profile, withIso(levers, year, shares)).years.find((y) => y.year === year)?.lines.amt?.value ?? 0;
  let lo = 0;
  let hi = available;
  if (amtAt(hi) <= 0) lo = hi;
  else {
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (amtAt(mid) > 0) hi = mid;
      else lo = mid;
    }
  }
  const current = Math.min(levers.exercises.iso[year] ?? 0, available);
  return { year, available, sharesBeforeAmt: lo, overCrossover: current > lo };
}

export interface SweepPoint {
  shares: number;
  amt: number;
  totalTax: number;
  planTotalTax: number;
  amtCreditCarryforwardEnd: number;
}

/** Vary this year's ISO exercise count from 0 to available and record what moves, for charting. */
export function sweepIsoExercise(profile: Profile, leverOverrides: Partial<Levers> | undefined, year: number, steps = 40): SweepPoint[] {
  const levers = resolveLevers(profile, leverOverrides);
  const available = sharesExercisable(profile, levers, "iso", year);
  const points: SweepPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const shares = Math.round((available * i) / steps);
    const res = runPlan(profile, withIso(levers, year, shares));
    const y = res.years.find((r) => r.year === year);
    if (!y) return [];
    points.push({ shares, amt: y.lines.amt!.value, totalTax: y.lines.totalTax!.value, planTotalTax: res.totals.totalTax, amtCreditCarryforwardEnd: res.totals.amtCreditCarryforwardEnd });
  }
  return points;
}

/**
 * The fewest shares a sale event must sell for its proceeds to pay the whole year's tax,
 * including the tax on the sale itself. Returns everything held when even that falls short.
 */
export function sharesToCover(profile: Profile, leverOverrides: Partial<Levers> | undefined, year: number, saleId: string): number {
  const levers = resolveLevers(profile, leverOverrides);
  const sales = levers.sales?.[year] ?? [];
  const sale = sales.find((s) => s.id === saleId);
  if (!sale) return 0;
  const withShares = (n: number): Partial<Levers> => ({ ...levers, sales: { ...(levers.sales ?? {}), [year]: sales.map((s) => (s.id === saleId ? { ...s, shares: n, lots: undefined } : s)) } });
  const run = (n: number) => runPlan(profile, withShares(n)).years.find((y) => y.year === year)!;
  const held = run(0).lotsBefore?.reduce((s, l) => s + l.quantity, 0) ?? 0;
  const gap = (n: number) => { const y = run(n); return y.inputs.saleProceeds - y.lines.totalTax!.value; };
  if (held === 0 || gap(held) < 0) return held;
  let lo = 0;
  let hi = held;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (gap(mid) >= 0) hi = mid; else lo = mid;
  }
  return hi;
}
