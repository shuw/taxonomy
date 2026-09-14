import type { EquityGrant, GrantType, Levers, Profile } from "./types.ts";

/** Per-share value of a grant in a plan year. */
export function grantFmv(profile: Profile, grant: EquityGrant, year: number): number {
  const base = grant.fmv ?? profile.equity.sharePrice;
  return base * (1 + profile.assumptions.fmvGrowth) ** (year - profile.plan.startYear);
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() >= a.getUTCDate() ? 0 : -1);
}

/**
 * Expand a grant's vesting into {vestedAtStart, byYear}. Shares that vested before the plan's
 * first day count as vested at start; `grant.vested` overrides that number when given.
 */
export function vestingOf(profile: Profile, grant: EquityGrant): { vestedAtStart: number; byYear: Record<number, number> } {
  const start = profile.plan.startYear;
  const end = start + profile.plan.years - 1;
  const byYear: Record<number, number> = {};
  let before = 0;
  if (grant.vesting) {
    for (const [y, n] of Object.entries(grant.vesting)) {
      const year = Number(y);
      if (year < start) before += n;
      else if (year <= end) byYear[year] = (byYear[year] ?? 0) + n;
    }
  } else if (grant.schedule) {
    const s = grant.schedule;
    const step = s.cadence === "annual" ? 12 : s.cadence === "quarterly" ? 3 : 1;
    const totalMonths = Math.max(step, Math.round(s.years * 12));
    const periods = Math.floor(totalMonths / step);
    const perPeriod = grant.shares / periods;
    const cliff = s.cliffMonths ?? 0;
    const startDate = new Date(s.start + "T00:00:00Z");
    const planStart = new Date(Date.UTC(start, 0, 1));
    let vestedSoFar = 0;
    for (let i = 1; i <= periods; i++) {
      const month = i * step;
      if (month < cliff) continue;
      // everything accrued up to this point vests now (the cliff lumps earlier periods together)
      const target = Math.round(perPeriod * i);
      const amount = target - vestedSoFar;
      vestedSoFar = target;
      if (amount <= 0) continue;
      const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + month, startDate.getUTCDate()));
      if (d < planStart) before += amount;
      else if (d.getUTCFullYear() <= end) byYear[d.getUTCFullYear()] = (byYear[d.getUTCFullYear()] ?? 0) + amount;
    }
    void monthsBetween;
  }
  const vestedAtStart = grant.vested ?? before;
  return { vestedAtStart: Math.min(grant.shares, vestedAtStart), byYear };
}

/** Shares of a grant that have vested by the end of `year`. */
export function vestedThrough(profile: Profile, grant: EquityGrant, year: number): number {
  const v = vestingOf(profile, grant);
  let total = v.vestedAtStart;
  for (const [y, n] of Object.entries(v.byYear)) if (Number(y) <= year) total += n;
  return Math.min(grant.shares, total);
}

const grantsOf = (profile: Profile, type: GrantType) => profile.equity.grants.filter((g) => g.type === type);

const exercisedBefore = (levers: Levers, type: "iso" | "nso", year: number) =>
  Object.entries(levers.exercises[type]).reduce((s, [y, n]) => (Number(y) < year ? s + n : s), 0);

/** Option shares of a type exercisable in `year`: vested through that year, less earlier exercises. */
export function sharesExercisable(profile: Profile, levers: Levers, type: "iso" | "nso", year: number): number {
  const vested = grantsOf(profile, type).reduce((s, g) => s + vestedThrough(profile, g, year), 0);
  return Math.max(0, vested - exercisedBefore(levers, type, year));
}

/** Total shares in grants of a type. */
export function sharesGranted(profile: Profile, type: GrantType): number {
  return grantsOf(profile, type).reduce((s, g) => s + g.shares, 0);
}

/**
 * Spread (FMV - strike) on `shares` exercised in `year`, drawing from grants of that type in
 * profile order, each limited to what it has vested and not already been drawn down.
 */
export function exerciseSpread(profile: Profile, levers: Levers, type: "iso" | "nso", year: number, shares: number): number {
  let alreadyUsed = exercisedBefore(levers, type, year);
  let remaining = shares;
  let spread = 0;
  for (const g of grantsOf(profile, type)) {
    const vested = vestedThrough(profile, g, year);
    const skip = Math.min(vested, alreadyUsed);
    alreadyUsed -= skip;
    const take = Math.min(vested - skip, remaining);
    if (take > 0) {
      spread += take * Math.max(0, grantFmv(profile, g, year) - (g.strike ?? 0));
      remaining -= take;
    }
  }
  return spread;
}

/** RSU units vesting in `year` and the ordinary income they create. */
export function rsuVesting(profile: Profile, year: number): { shares: number; income: number } {
  let shares = 0;
  let income = 0;
  for (const g of grantsOf(profile, "rsu")) {
    const n = vestingOf(profile, g).byYear[year] ?? 0;
    shares += n;
    income += n * grantFmv(profile, g, year);
  }
  return { shares, income };
}

/** Weighted spread per share for the next share exercised of a type in a year (for display). */
export function nextShareSpread(profile: Profile, type: "iso" | "nso", year: number): number {
  const g = grantsOf(profile, type)[0];
  return g ? Math.max(0, grantFmv(profile, g, year) - (g.strike ?? 0)) : 0;
}
