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
 * Expand a grant's vesting into {vestedAtStart, byYear}. vestedAtStart is what had vested (and,
 * for options, was still unexercised) as of the counts' date, which defaults to the plan's first
 * day; byYear holds schedule vests after that date. `vestedToDate` overrides the schedule for
 * everything up to the counts' date, so portal numbers read mid-year do not double count.
 */
/** The $100k rule: the most option shares that can first become exercisable as ISOs in one year. */
const ISO_ANNUAL_LIMIT = 100_000;

/** The vests of one grant inside the plan, dated: explicit dates, year keys (January 1), or the schedule's dates. */
export function vestEvents(profile: Profile, grant: EquityGrant): { date: string; shares: number }[] {
  const start = profile.plan.startYear;
  const end = start + profile.plan.years - 1;
  const asOf = grant.countsAsOf && grant.vestedToDate !== undefined ? new Date(grant.countsAsOf + "T00:00:00Z") : new Date(Date.UTC(start, 0, 1));
  const out: { date: string; shares: number }[] = [];
  const push = (d: Date, n: number) => { if (n > 0 && d > asOf && d.getUTCFullYear() >= start && d.getUTCFullYear() <= end) out.push({ date: d.toISOString().slice(0, 10), shares: n }); };
  if (grant.vesting) {
    for (const [k, n] of Object.entries(grant.vesting)) {
      if (/^\d{4}$/.test(k)) { const y = Number(k); if (n > 0 && y >= asOf.getUTCFullYear() && y >= start && y <= end) out.push({ date: `${y}-01-01`, shares: n }); }
      else push(new Date(k + "T00:00:00Z"), n);
    }
  } else if (grant.schedule) {
    const s = grant.schedule;
    const step = s.cadence === "annual" ? 12 : s.cadence === "quarterly" ? 3 : 1;
    const totalMonths = Math.max(step, Math.round(s.years * 12));
    const periods = Math.floor(totalMonths / step);
    const perPeriod = grant.granted / periods;
    const cliff = s.cliffMonths ?? 0;
    const startDate = new Date(s.start + "T00:00:00Z");
    let vestedSoFar = 0;
    for (let i = 1; i <= periods; i++) {
      const month = i * step;
      if (month < cliff) continue;
      const target = Math.round(perPeriod * i);
      const amount = target - vestedSoFar;
      vestedSoFar = target;
      push(new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + month, startDate.getUTCDate())), amount);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** An ISO tranche and the NSO tranche split from it by the $100k rule share one schedule over their combined count. */
function splitPartner(profile: Profile, grant: EquityGrant): { iso: EquityGrant; nso: EquityGrant } | null {
  if (grant.type === "nso" && grant.splitOf) { const iso = profile.equity.grants.find((g) => g.id === grant.splitOf && g.type === "iso"); return iso ? { iso, nso: grant } : null; }
  if (grant.type === "iso") { const nso = profile.equity.grants.find((g) => g.type === "nso" && g.splitOf === grant.id); return nso ? { iso: grant, nso } : null; }
  return null;
}

export function vestingOf(profile: Profile, grant: EquityGrant): { vestedAtStart: number; byYear: Record<number, number> } {
  const pair = splitPartner(profile, grant);
  if (pair) {
    // Vest the combined grant on the ISO tranche's schedule, then give each year's first $100k of strike value to the ISO side.
    const combined: EquityGrant = { ...pair.iso, granted: pair.iso.granted + pair.nso.granted, vestedToDate: pair.iso.vestedToDate === undefined && pair.nso.vestedToDate === undefined ? undefined : (pair.iso.vestedToDate ?? 0) + (pair.nso.vestedToDate ?? 0), exercisedToDate: (pair.iso.exercisedToDate ?? 0) + (pair.nso.exercisedToDate ?? 0), splitOf: undefined };
    const all = vestingOfPlain(profile, combined);
    const cap = pair.iso.strike ? Math.floor(ISO_ANNUAL_LIMIT / pair.iso.strike) : Infinity;
    const byYear: Record<number, number> = {};
    for (const [y, n] of Object.entries(all.byYear)) { const isoPart = Math.min(n, cap); byYear[Number(y)] = grant.type === "iso" ? isoPart : n - isoPart; }
    // What vested before the plan is what each tranche's own counts say.
    const vestedAtStart = grant.vestedToDate !== undefined ? grant.vestedToDate : grant.type === "iso" ? Math.min(all.vestedAtStart, grant.granted) : Math.max(0, all.vestedAtStart - pair.iso.granted);
    return { vestedAtStart, byYear };
  }
  return vestingOfPlain(profile, grant);
}

function vestingOfPlain(profile: Profile, grant: EquityGrant): { vestedAtStart: number; byYear: Record<number, number> } {
  const start = profile.plan.startYear;
  const end = start + profile.plan.years - 1;
  const byYear: Record<number, number> = {};
  let before = 0;
  const asOf = grant.countsAsOf && grant.vestedToDate !== undefined ? new Date(grant.countsAsOf + "T00:00:00Z") : new Date(Date.UTC(start, 0, 1));
  if (grant.vesting) {
    for (const [k, n] of Object.entries(grant.vesting)) {
      // A year key means "during that year"; a date key is compared to the day the counts were read.
      const isYear = /^\d{4}$/.test(k);
      const d = isYear ? new Date(Date.UTC(Number(k), 0, 1)) : new Date(k + "T00:00:00Z");
      const year = d.getUTCFullYear();
      const past = isYear ? year < asOf.getUTCFullYear() : d <= asOf;
      if (past || year < start) before += n;
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
    let vestedSoFar = 0;
    for (let i = 1; i <= periods; i++) {
      const month = i * step;
      if (month < cliff) continue;
      const target = Math.round(perPeriod * i);
      const amount = target - vestedSoFar;
      vestedSoFar = target;
      if (amount <= 0) continue;
      const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + month, startDate.getUTCDate()));
      if (d <= asOf || d.getUTCFullYear() < start) before += amount;
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

const grantsOf = (profile: Profile, type: GrantType, company?: string) =>
  profile.equity.grants.filter((g) => g.type === type && (company === undefined || companyOf(profile, g)?.id === company));

/** The company an exercise lever key refers to: "*" (unscoped) means the first company. */
export const resolveCompany = (profile: Profile, key: string): string | undefined => (key === "*" ? profile.equity.companies[0]?.id : key);

/** Shares of a type exercised in a year for one company (the "*" key counts toward the first company). */
export function exercisedIn(profile: Profile, levers: Levers, type: "iso" | "nso", year: number, company: string | undefined): number {
  return Object.entries(levers.exercises[type][year] ?? {}).reduce((s, [k, n]) => (resolveCompany(profile, k) === company ? s + n : s), 0);
}

const exercisedBefore = (profile: Profile, levers: Levers, type: "iso" | "nso", year: number, company: string | undefined) =>
  Object.keys(levers.exercises[type]).reduce((s, y) => (Number(y) < year ? s + exercisedIn(profile, levers, type, Number(y), company) : s), 0);

const companiesWith = (profile: Profile, type: GrantType): (string | undefined)[] =>
  [...new Set(grantsOf(profile, type).map((g) => companyOf(profile, g)?.id))];

/**
 * Option shares of a type exercisable in `year`, for one company or all: vested through that
 * year, less exercises in earlier plan years.
 */
export function sharesExercisable(profile: Profile, levers: Levers, type: "iso" | "nso", year: number, company?: string): number {
  if (company === undefined) return companiesWith(profile, type).reduce((s, c) => s + sharesExercisable(profile, levers, type, year, c ?? "*"), 0);
  const c = resolveCompany(profile, company);
  const vested = grantsOf(profile, type, c).reduce((s, g) => s + vestedThrough(profile, g, year), 0);
  return Math.max(0, vested - exercisedBefore(profile, levers, type, year, c));
}

/** One line per grant drawn on by this year's exercises of a type: each company's shares come from its own grants in profile order. */
export function exerciseDraws(profile: Profile, levers: Levers, type: "iso" | "nso", year: number): { grant: EquityGrant; shares: number; fmv: number; company: string | undefined }[] {
  const out: { grant: EquityGrant; shares: number; fmv: number; company: string | undefined }[] = [];
  for (const c of companiesWith(profile, type)) {
    let alreadyUsed = exercisedBefore(profile, levers, type, year, c);
    let remaining = Math.min(exercisedIn(profile, levers, type, year, c), sharesExercisable(profile, levers, type, year, c ?? "*"));
    for (const g of grantsOf(profile, type, c)) {
      const vested = vestedThrough(profile, g, year);
      const skip = Math.min(vested, alreadyUsed);
      alreadyUsed -= skip;
      const take = Math.min(vested - skip, remaining);
      if (take > 0) { out.push({ grant: g, shares: take, fmv: grantFmv(profile, g, year), company: c }); remaining -= take; }
    }
  }
  return out;
}

/** Shares still in play across grants of a type. */
export function sharesGranted(profile: Profile, type: GrantType): number {
  return grantsOf(profile, type).reduce((s, g) => s + sharesOutstanding(g), 0);
}

/** Spread (FMV - strike) on this year's exercises of a type, summed over the grants drawn. */
export function exerciseSpread(profile: Profile, levers: Levers, type: "iso" | "nso", year: number): number {
  return exerciseDraws(profile, levers, type, year).reduce((s, d) => s + d.shares * Math.max(0, d.fmv - (d.grant.strike ?? 0)), 0);
}

/** Cash to exercise this year's draws of a type: shares × strike. */
export function exerciseCost(profile: Profile, levers: Levers, type: "iso" | "nso", year: number): number {
  return exerciseDraws(profile, levers, type, year).reduce((s, d) => s + d.shares * (d.grant.strike ?? 0), 0);
}

/** Shares of a type actually exercised this year after availability caps, across companies. */
export function sharesExercised(profile: Profile, levers: Levers, type: "iso" | "nso", year: number): number {
  return exerciseDraws(profile, levers, type, year).reduce((s, d) => s + d.shares, 0);
}

/**
 * RSU units that become taxable income in `year`. Single-trigger units count when they vest.
 * Double-trigger units (settlement: liquidity) count in the company's liquidity year, all
 * units time-vested by then at once, and per vest after that; with no liquidity year they
 * produce no income in the plan.
 */
export function rsuVesting(profile: Profile, year: number): { shares: number; income: number } {
  return rsuVests(profile, year).reduce((acc, v) => ({ shares: acc.shares + v.shares, income: acc.income + v.income }), { shares: 0, income: 0 });
}

/**
 * RSU settlements in a year, one per vest date, so the shares they deliver carry the right
 * acquisition date into the lot ledger. Double-trigger units already time-vested settle on the
 * liquidity event's day (January 1 of that year when no day is known).
 */
export function rsuVests(profile: Profile, year: number): { date: string; shares: number; income: number; grant: EquityGrant }[] {
  const out: { date: string; shares: number; income: number; grant: EquityGrant }[] = [];
  for (const g of grantsOf(profile, "rsu")) {
    const fmv = grantFmv(profile, g, year);
    const events = vestEvents(profile, g);
    const inYear = events.filter((e) => e.date.startsWith(`${year}-`));
    if (g.settlement === "liquidity") {
      const ly = companyOf(profile, g)?.liquidityYear;
      if (ly === undefined || year < ly) continue;
      if (year === ly) {
        const settleDate = `${year}-01-01`;
        const earlier = vestingOf(profile, g).vestedAtStart + events.filter((e) => e.date < settleDate).reduce((s, e) => s + e.shares, 0);
        if (earlier > 0) out.push({ date: settleDate, shares: earlier, income: earlier * fmv, grant: g });
        for (const e of inYear.filter((e) => e.date >= settleDate)) out.push({ date: e.date, shares: e.shares, income: e.shares * fmv, grant: g });
      } else for (const e of inYear) out.push({ date: e.date, shares: e.shares, income: e.shares * fmv, grant: g });
    } else for (const e of inYear) out.push({ date: e.date, shares: e.shares, income: e.shares * fmv, grant: g });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Grants with unvested shares but no schedule or vest dates: nothing more of them will vest in the plan. */
export function grantsMissingVesting(profile: Profile): EquityGrant[] {
  return profile.equity.grants.filter((g) => !g.schedule && !g.vesting && g.granted - (g.vestedToDate ?? 0) > 0);
}

/** Spread per share for the next share exercised of a type in a year (for display), for one company or the first. */
export function nextShareSpread(profile: Profile, type: "iso" | "nso", year: number, company?: string): number {
  const g = grantsOf(profile, type, company === undefined ? undefined : resolveCompany(profile, company))[0];
  return g ? Math.max(0, grantFmv(profile, g, year) - (g.strike ?? 0)) : 0;
}

/** A company's display name by id; the first company when the id is missing. */
export function companyName(profile: Profile, id: string | undefined): string {
  return (profile.equity.companies.find((c) => c.id === id) ?? profile.equity.companies[0])?.name ?? "";
}

/** Ids of companies that have grants of a type, in profile order. */
export function companiesWithGrants(profile: Profile, type: GrantType): string[] {
  return companiesWith(profile, type).filter((c): c is string => c !== undefined);
}

/** A short unique id for a new grant, holding, company or change: one past the highest number in use, so a removed item's id is not handed to the next one. */
export function newId(prefix: string, taken: Iterable<string>): string {
  let max = 0;
  for (const id of taken) {
    const m = id.match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}
