import { isoSharesAvailable, resolveLevers, runPlan } from "./plan.ts";
import type { Levers, Profile } from "./types.ts";

export interface AmtCrossover {
  year: number;
  /** Shares available to exercise in this year given earlier years' exercises. */
  available: number;
  /** Largest number of shares exercisable this year with zero AMT (holding other years fixed). */
  sharesBeforeAmt: number;
  /** Whether the current lever position is already past the crossover. */
  overCrossover: boolean;
}

/** Binary-search the ISO exercise count in `year` at which AMT first appears. */
export function amtCrossover(profile: Profile, leverOverrides: Partial<Levers> | undefined, year: number): AmtCrossover {
  const levers = resolveLevers(profile, leverOverrides);
  const available = isoSharesAvailable(profile, levers, year);
  const amtAt = (shares: number): number => {
    const l: Levers = { isoExercises: { ...levers.isoExercises, [year]: shares } };
    const res = runPlan(profile, l);
    return res.years.find((y) => y.year === year)!.lines.amt!.value;
  };
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
  const current = levers.isoExercises[year] ?? 0;
  return { year, available, sharesBeforeAmt: lo, overCrossover: current > lo };
}

export interface SweepPoint {
  shares: number;
  amt: number;
  totalTax: number;
  planTotalTax: number;
  amtCreditCarryforwardEnd: number;
}

/** Vary this year's exercise count from 0 to available and record what moves, for charting. */
export function sweepIsoExercise(profile: Profile, leverOverrides: Partial<Levers> | undefined, year: number, steps = 40): SweepPoint[] {
  const levers = resolveLevers(profile, leverOverrides);
  const available = isoSharesAvailable(profile, levers, year);
  const points: SweepPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const shares = Math.round((available * i) / steps);
    const res = runPlan(profile, { isoExercises: { ...levers.isoExercises, [year]: shares } });
    const y = res.years.find((r) => r.year === year)!;
    points.push({ shares, amt: y.lines.amt!.value, totalTax: y.lines.totalTax!.value, planTotalTax: res.totals.totalTax, amtCreditCarryforwardEnd: res.totals.amtCreditCarryforwardEnd });
  }
  return points;
}
