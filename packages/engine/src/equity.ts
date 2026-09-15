import type { Company, EquityGrant, GrantType, Levers, Profile } from "./types.ts";

export function companyOf(profile: Profile, ref: { company?: string }): Company | undefined {
  return profile.equity.companies.find((c) => c.id === ref.company) ?? profile.equity.companies[0];
}

/** Per-share value of a company in a plan year: the price path where given, growth from the last known point otherwise. */
export function companyPrice(profile: Profile, company: Company | undefined, year: number): number {
  if (!company) return 0;
  const growth = company.growth ?? profile.assumptions.fmvGrowth;
  const points = Object.entries(company.pricePath ?? {}).map(([y, p]) => [Number(y), p] as const).filter(([y]) => y <= year).sort((a, b) => a[0] - b[0]);
  const last = points[points.length - 1];
  const [baseYear, basePrice] = last ?? [profile.plan.startYear, company.sharePrice];
  return basePrice * (1 + growth) ** Math.max(0, year - baseYear);
}

/** Per-share value of a grant's stock in a plan year. */
export function grantFmv(profile: Profile, grant: EquityGrant, year: number): number {
  return companyPrice(profile, companyOf(profile, grant), year);
}

/** Option shares of a grant not yet exercised (vested or not); all units for RSUs. */
export function sharesOutstanding(g: EquityGrant): number {
  return Math.max(0, g.granted - (g.type === "rsu" ? 0 : g.exercisedToDate ?? 0));
}

/**
 * Expand a grant's vesting into {vestedAtStart, byYear}, where vestedAtStart is what has vested
 * and is still in play at the plan's first day (options: vested and unexercised; RSUs: already
 * delivered). `vestedToDate` overrides the schedule for the past.
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
    const perPeriod = grant.granted / periods;
    const cliff = s.cliffMonths ?? 0;
    const startDate = new Date(s.start + "T00:00:00Z");
    const planStart = new Date(Date.UTC(start, 0, 1));
    let vestedSoFar = 0;
    for (let i = 1; i <= periods; i++) {
      const month = i * step;
      if (month < cliff) continue;
      const target = Math.round(perPeriod * i);
      const amount = target - vestedSoFar;
      vestedSoFar = target;
      if (amount <= 0) continue;
      const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + month, startDate.getUTCDate()));
      if (d < planStart) before += amount;
      else if (d.getUTCFullYear() <= end) byYear[d.getUTCFullYear()] = (byYear[d.getUTCFullYear()] ?? 0) + amount;
    }
  }
  const vestedToDate = Math.min(grant.granted, grant.vestedToDate ?? before);
  const exercised = grant.type === "rsu" ? 0 : Math.min(vestedToDate, grant.exercisedToDate ?? 0);
  // Future vesting can never exceed what is still unvested.
  const unvested = grant.granted - vestedToDate;
  let remaining = unvested;
  for (const y of Object.keys(byYear).map(Number).sort()) {
    const n = Math.min(byYear[y]!, remaining);
    byYear[y] = n;
    remaining -= n;
  }
  return { vestedAtStart: vestedToDate - exercised, byYear };
}

/** Shares of a grant vested (and, for options, unexercised before the plan) by the end of `year`. */
export function vestedThrough(profile: Profile, grant: EquityGrant, year: number): number {
  const v = vestingOf(profile, grant);
  let total = v.vestedAtStart;
  for (const [y, n] of Object.entries(v.byYear)) if (Number(y) <= year) total += n;
  return Math.min(sharesOutstanding(grant), total);
}

const grantsOf = (profile: Profile, type: GrantType) => profile.equity.grants.filter((g) => g.type === type);

const exercisedBefore = (levers: Levers, type: "iso" | "nso", year: number) =>
  Object.entries(levers.exercises[type]).reduce((s, [y, n]) => (Number(y) < year ? s + n : s), 0);

/** Option shares of a type exercisable in `year`: vested through that year, less exercises in earlier plan years. */
export function sharesExercisable(profile: Profile, levers: Levers, type: "iso" | "nso", year: number): number {
  const vested = grantsOf(profile, type).reduce((s, g) => s + vestedThrough(profile, g, year), 0);
  return Math.max(0, vested - exercisedBefore(levers, type, year));
}

/** Shares still in play across grants of a type. */
export function sharesGranted(profile: Profile, type: GrantType): number {
  return grantsOf(profile, type).reduce((s, g) => s + sharesOutstanding(g), 0);
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

/**
 * RSU units that become taxable income in `year`. Single-trigger units count when they vest.
 * Double-trigger units (settlement: liquidity) count in the company's liquidity year, all
 * units time-vested by then at once, and per vest after that; with no liquidity year they
 * produce no income in the plan.
 */
export function rsuVesting(profile: Profile, year: number): { shares: number; income: number } {
  let shares = 0;
  let income = 0;
  for (const g of grantsOf(profile, "rsu")) {
    const v = vestingOf(profile, g);
    let n: number;
    if (g.settlement === "liquidity") {
      const ly = companyOf(profile, g)?.liquidityYear;
      if (ly === undefined || year < ly) n = 0;
      else if (year === ly) n = v.vestedAtStart + Object.entries(v.byYear).reduce((s, [y, k]) => (Number(y) <= year ? s + k : s), 0);
      else n = v.byYear[year] ?? 0;
    } else n = v.byYear[year] ?? 0;
    shares += n;
    income += n * grantFmv(profile, g, year);
  }
  return { shares, income };
}

/** Grants with unvested shares but no schedule or vest dates: nothing more of them will vest in the plan. */
export function grantsMissingVesting(profile: Profile): EquityGrant[] {
  return profile.equity.grants.filter((g) => !g.schedule && !g.vesting && g.granted - (g.vestedToDate ?? 0) > 0);
}

/** Spread per share for the next share exercised of a type in a year (for display). */
export function nextShareSpread(profile: Profile, type: "iso" | "nso", year: number): number {
  const g = grantsOf(profile, type)[0];
  return g ? Math.max(0, grantFmv(profile, g, year) - (g.strike ?? 0)) : 0;
}

/** A short unique id for a new grant, holding or company. */
export function newId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!set.has(id)) return id;
  }
}
