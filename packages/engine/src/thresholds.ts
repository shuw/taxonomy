import { exerciseDraws, exercisedIn, resolveCompany, sharesExercisable } from "./equity.ts";
import { resolveLevers, runPlan, stateBefore, yearFrom, runPlanFrom } from "./plan.ts";
import type { Levers, PlanResult, Profile } from "./types.ts";

export interface AmtCrossover {
  year: number;
  /** Company id the sweep varies; other companies' exercises that year stay as they are. */
  company: string;
  /** ISO shares exercisable in this year given vesting and earlier years' exercises. */
  available: number;
  /** Largest number of ISO shares exercisable this year with zero AMT (holding other years fixed). */
  sharesBeforeAmt: number;
  /** Whether the current lever position is already past the crossover. */
  overCrossover: boolean;
}

/** The company an analysis is about: the one named, else the first. */
const companyKey = (profile: Profile, company?: string) => company ?? profile.equity.companies[0]?.id ?? "*";

const withIso = (levers: Levers, year: number, company: string, shares: number): Partial<Levers> => ({
  ...levers,
  exercises: { iso: { ...levers.exercises.iso, [year]: { ...(levers.exercises.iso[year] ?? {}), [company]: shares } }, nso: levers.exercises.nso },
});

/** Binary-search the ISO exercise count in `year` for one company at which AMT first appears. Only that year is recomputed per probe. */
export function amtCrossover(profile: Profile, leverOverrides: Partial<Levers> | undefined, year: number, company?: string): AmtCrossover {
  const levers = resolveLevers(profile, leverOverrides);
  const c = companyKey(profile, company);
  const available = sharesExercisable(profile, levers, "iso", year, c);
  const before = stateBefore(profile, levers, year);
  const amtAt = (shares: number): number => yearFrom(profile, resolveLevers(profile, withIso(levers, year, c, shares)), year, before).lines.amt?.value ?? 0;
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
  const current = Math.min(exercisedIn(profile, levers, "iso", year, resolveCompany(profile, c)), available);
  return { year, company: c, available, sharesBeforeAmt: lo, overCrossover: current > lo };
}

export interface SweepPoint {
  shares: number;
  amt: number;
  totalTax: number;
  planTotalTax: number;
  amtCreditCarryforwardEnd: number;
}

/**
 * Vary this year's ISO exercise count from 0 to available and record what moves, for charting.
 * Each point recomputes this year only; the plan-wide totals are exact at the two ends and
 * interpolated between, since they need the later years too.
 */
export function sweepIsoExercise(profile: Profile, leverOverrides: Partial<Levers> | undefined, year: number, steps = 40, company?: string): SweepPoint[] {
  const levers = resolveLevers(profile, leverOverrides);
  const c = companyKey(profile, company);
  const available = sharesExercisable(profile, levers, "iso", year, c);
  if (!profile.plan || year < profile.plan.startYear || year >= profile.plan.startYear + profile.plan.years) return [];
  const before = stateBefore(profile, levers, year);
  const prefix = runPlan(profile, levers).years.filter((y) => y.year < year);
  const full = (shares: number) => runPlanFrom(profile, resolveLevers(profile, withIso(levers, year, c, shares)), year, before, prefix);
  const ends = { 0: full(0), [available]: full(available) } as Record<number, ReturnType<typeof full>>;
  const points: SweepPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const shares = Math.round((available * i) / steps);
    const y = yearFrom(profile, resolveLevers(profile, withIso(levers, year, c, shares)), year, before);
    const t = available > 0 ? shares / available : 0;
    const lerp = (a: number, b: number) => a + (b - a) * t;
    const e0 = ends[0]!, e1 = ends[available] ?? e0;
    points.push({ shares, amt: y.lines.amt!.value, totalTax: y.lines.totalTax!.value, planTotalTax: lerp(e0.totals.totalTax, e1.totals.totalTax), amtCreditCarryforwardEnd: lerp(e0.totals.amtCreditCarryforwardEnd, e1.totals.amtCreditCarryforwardEnd) });
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

export interface CreditRecovery {
  year: number;
  company: string;
  shares: number;
  /** Credit this exercise adds in its year. */
  generated: number;
  /** Per later plan year: credit from this exercise used that year, and what is still unrecovered after it. */
  path: { year: number; recovered: number; remaining: number }[];
  /** Still unrecovered at the end of the plan. */
  leftover: number;
  /** Year it would clear at the recent pace, when that is beyond the plan; null when nothing comes back. */
  projectedYear: number | null;
}

/** How the AMT credit from one year's ISO exercise comes back: the plan with the exercise against the plan without it. */
export function creditRecovery(profile: Profile, leverOverrides: Partial<Levers> | undefined, year: number, company?: string, base?: PlanResult): CreditRecovery | null {
  const levers = resolveLevers(profile, leverOverrides);
  const c = companyKey(profile, company);
  const shares = exercisedIn(profile, levers, "iso", year, resolveCompany(profile, c));
  if (shares <= 0) return null;
  const withIt = (base ?? runPlan(profile, levers)).years;
  const without = runPlan(profile, withIso(levers, year, c, 0)).years;
  const at = (ys: typeof withIt, y: number, id: string) => ys.find((r) => r.year === y)?.lines[id]?.value ?? 0;
  const generated = at(withIt, year, "amtCreditGenerated") - at(without, year, "amtCreditGenerated");
  if (generated <= 0) return null;
  let remaining = generated;
  const path: CreditRecovery["path"] = [];
  for (const r of withIt) {
    if (r.year <= year) continue;
    const recovered = Math.max(0, Math.min(remaining, at(withIt, r.year, "amtCreditUsed") - at(without, r.year, "amtCreditUsed")));
    remaining -= recovered;
    path.push({ year: r.year, recovered, remaining });
  }
  const recent = path.slice(-2).map((p) => p.recovered);
  const pace = recent.length ? recent.reduce((s, n) => s + n, 0) / recent.length : 0;
  const lastYear = withIt[withIt.length - 1]!.year;
  const projectedYear = remaining <= 0 ? (path.find((p) => p.remaining <= 0)?.year ?? year) : pace > 0 ? lastYear + Math.ceil(remaining / pace) : null;
  return { year, company: c, shares, generated, path, leftover: Math.max(0, remaining), projectedYear };
}

export interface HoldOrSell {
  year: number;
  company: string;
  shares: number;
  /** Price per share assumed for the sale in each path. */
  holdPrice: number;
  sellPrice: number;
  hold: { taxInYear: number; taxOverPlan: number; cashNeeded: number; proceeds: number; netOverPlan: number; saleYear: number };
  sell: { taxInYear: number; taxOverPlan: number; cashNeeded: number; proceeds: number; netOverPlan: number };
}

/**
 * The two ways to handle one year's ISO exercise: hold the shares and sell them the next year
 * (long-term and qualifying when the dates allow), or sell them the same day they are exercised
 * (a disqualifying disposition: ordinary income, no AMT). Both paths are the current plan with
 * a sale of exactly those shares added, so every other decision stays as it is.
 */
export function holdOrSell(profile: Profile, leverOverrides: Partial<Levers> | undefined, year: number, company?: string): HoldOrSell | null {
  const levers = resolveLevers(profile, leverOverrides);
  const c = companyKey(profile, company);
  const draws = exerciseDraws(profile, levers, "iso", year).filter((d) => d.company === resolveCompany(profile, c));
  const shares = draws.reduce((s, d) => s + d.shares, 0);
  if (shares <= 0) return null;
  const lots = Object.fromEntries(draws.map((d) => [`x-${d.grant.id}-${year}`, d.shares]));
  const lastYear = profile.plan.startYear + profile.plan.years - 1;
  const saleYear = Math.min(lastYear, year + 1);
  const withSale = (saleYearFor: number, date: string) => runPlan(profile, { ...levers, sales: { ...(levers.sales ?? {}), [saleYearFor]: [...(levers.sales?.[saleYearFor] ?? []), { id: "__compare", shares, date, lots }] } });
  const holdPlan = withSale(saleYear, `${saleYear}-12-30`);
  const sellPlan = withSale(year, levers.exerciseDates?.iso[year] ?? `${year}-01-01`);
  // Both paths are measured against the same baseline: the plan with neither the exercise nor the sale.
  const none = runPlan(profile, withIso(levers, year, c, 0));
  const yr = (p: typeof none, y: number) => p.years.find((r) => r.year === y)!;
  const summarize = (p: typeof none, saleY: number) => {
    const y = yr(p, year);
    const sale = yr(p, saleY).sales?.find((s) => s.lots.some((l) => l.lotId in lots));
    const proceeds = sale?.lots.filter((l) => l.lotId in lots).reduce((s, l) => s + l.proceeds, 0) ?? 0;
    const taxOverPlan = p.totals.totalTax - none.totals.totalTax;
    return { taxInYear: y.lines.totalTax!.value, taxOverPlan, cashNeeded: y.inputs.exerciseCost + y.lines.totalTax!.value - (saleY === year ? proceeds : 0), proceeds, netOverPlan: proceeds - taxOverPlan - y.inputs.exerciseCost };
  };
  const hold = summarize(holdPlan, saleYear);
  const sell = summarize(sellPlan, year);
  const price = (p: typeof none, y: number) => { const s = yr(p, y).sales?.find((s) => s.lots.some((l) => l.lotId in lots)); const l = s?.lots.find((l) => l.lotId in lots); return l?.price ?? 0; };
  return { year, company: c, shares, holdPrice: price(holdPlan, saleYear), sellPrice: price(sellPlan, year), hold: { ...hold, saleYear }, sell };
}
