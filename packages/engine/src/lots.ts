import { companyPrice, exerciseDraws, rsuVests } from "./equity.ts";
import type { Holding, Levers, Owner, Profile, SaleLever } from "./types.ts";

/** Shares you hold, by acquisition, with the two bases that matter when they are sold. */
export interface Lot {
  id: string;
  label: string;
  company?: string;
  owner?: Owner;
  quantity: number;
  /** YYYY-MM-DD */
  acquired: string;
  via: Holding["via"];
  /** Regular basis per share. */
  costBasis: number;
  /** AMT basis per share; for ISO shares the value at exercise. */
  amtBasis: number;
  /** ISO shares only: the option's grant date, for the two-year test. */
  grantDate?: string;
}

/** One lot's part of a sale, with the tax character of its gain. */
export interface LotSale {
  lotId: string;
  label: string;
  shares: number;
  price: number;
  costBasis: number;
  proceeds: number;
  /** ISO disqualifying disposition: the spread at exercise, limited to the actual gain, taxed as ordinary income. */
  ordinaryIncome: number;
  /** Capital gain after any ordinary part; negative is a loss. */
  capitalGain: number;
  longTerm: boolean;
  /** ISO shares: held over a year from exercise and two from grant. */
  qualifying: boolean | null;
  /** Added to AMTI: the AMT basis is higher than the regular basis for ISO shares, so the AMT gain is smaller. */
  amtAdjustment: number;
}

export interface SaleResult {
  /** The sale event this came from. */
  id: string;
  date: string;
  shares: number;
  proceeds: number;
  longTermGain: number;
  shortTermGain: number;
  ordinaryIncome: number;
  amtAdjustment: number;
  lots: LotSale[];
  /** How lots were chosen. */
  picked: "lowest tax first" | "as specified";
}

/** Day arithmetic on YYYY-MM-DD strings. */
export function addYears(date: string, years: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}
export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The first day a lot bought on `acquired` counts as held more than one year. */
export const longTermFrom = (acquired: string) => addDays(addYears(acquired, 1), 1);
/** The first day ISO shares pass both tests: more than a year from exercise and two from grant. */
export const qualifyingFrom = (lot: Lot) => {
  const a = longTermFrom(lot.acquired);
  if (!lot.grantDate) return a;
  const b = addDays(addYears(lot.grantDate, 2), 1);
  return a > b ? a : b;
};

export function isLongTerm(lot: Lot, saleDate: string): boolean {
  return saleDate >= longTermFrom(lot.acquired);
}
export function isQualifying(lot: Lot, saleDate: string): boolean | null {
  if (lot.via !== "iso_exercise") return null;
  return saleDate >= qualifyingFrom(lot);
}

export function openingLots(profile: Profile): Lot[] {
  return (profile.equity.holdings ?? []).map((h) => ({
    id: h.id,
    label: h.lot,
    company: h.company,
    owner: h.owner,
    quantity: h.quantity,
    acquired: h.acquired,
    via: h.via,
    costBasis: h.costBasis,
    amtBasis: h.amtBasis ?? h.costBasis,
    grantDate: h.grantDate,
  }));
}

/**
 * Lots created by exercising `shares` of a type in `year`, one per grant drawn, in the same
 * order exerciseSpread draws them. ISO lots keep the strike as basis and the value at
 * exercise as AMT basis; NSO lots start at the value at exercise, since the spread was wages.
 */
export function lotsFromExercise(profile: Profile, levers: Levers, type: "iso" | "nso", year: number, date: string): Lot[] {
  return exerciseDraws(profile, levers, type, year).map(({ grant: g, shares, fmv, company }) => ({
    id: `x-${g.id}-${year}`,
    label: `${type.toUpperCase()} exercise ${year} (${g.name})`,
    company,
    owner: g.owner,
    quantity: shares,
    acquired: date,
    via: type === "iso" ? "iso_exercise" : "nso_exercise",
    costBasis: type === "iso" ? (g.strike ?? 0) : fmv,
    amtBasis: fmv,
    grantDate: g.grantDate,
  }));
}

/** The lot RSU units settling in `year` become; their value was wages, so it is the basis. */
/** One lot per RSU settlement in the year, each acquired on its vest date. */
export function lotsFromRsu(profile: Profile, year: number): Lot[] {
  return rsuVests(profile, year).map((v, i) => ({
    id: `rsu-${year}-${i + 1}`, label: `RSUs settled ${v.date}`, company: v.grant.company ?? profile.equity.companies[0]?.id,
    quantity: v.shares, acquired: v.date, via: "rsu_vest" as const, costBasis: v.income / v.shares, amtBasis: v.income / v.shares,
  }));
}

/** Per-share value of a lot's company in a year, unless the sale names its own price. */
export function lotPrice(profile: Profile, lot: Lot, year: number, override?: number): number {
  if (override !== undefined) return override;
  return companyPrice(profile, profile.equity.companies.find((c) => c.id === lot.company) ?? profile.equity.companies[0], year);
}

/**
 * Order lots for a sale so the cheapest tax goes first: ISO lots that qualify and other lots
 * held long-term come first, highest basis first; then short-term and disqualifying lots,
 * again highest basis first.
 */
export function lowestTaxOrder(lots: Lot[], saleDate: string): Lot[] {
  const rank = (l: Lot) => {
    const q = isQualifying(l, saleDate);
    if (q === true) return 0;
    if (q === null && isLongTerm(l, saleDate)) return 0;
    if (q === false && isLongTerm(l, saleDate)) return 2;
    return 1;
  };
  return [...lots].filter((l) => l.quantity > 0).sort((a, b) => rank(a) - rank(b) || b.costBasis - a.costBasis || a.acquired.localeCompare(b.acquired));
}

/** Sell shares out of `lots`, returning what remains and the tax result. */
export function applySale(profile: Profile, lots: Lot[], sale: SaleLever, year: number): { remaining: Lot[]; result: SaleResult } {
  const date = sale.date ?? `${year}-12-31`;
  const remaining = lots.map((l) => ({ ...l }));
  const byId = new Map(remaining.map((l) => [l.id, l]));
  const picks: { lot: Lot; shares: number }[] = [];
  const explicit = sale.lots && Object.keys(sale.lots).length > 0;
  if (explicit) {
    for (const [id, n] of Object.entries(sale.lots!)) {
      const lot = byId.get(id);
      if (lot && n > 0) picks.push({ lot, shares: Math.min(lot.quantity, n) });
    }
  } else {
    let left = sale.shares;
    for (const lot of lowestTaxOrder(remaining, date)) {
      if (left <= 0) break;
      const n = Math.min(lot.quantity, left);
      picks.push({ lot, shares: n });
      left -= n;
    }
  }
  const result: SaleResult = { id: sale.id, date, shares: 0, proceeds: 0, longTermGain: 0, shortTermGain: 0, ordinaryIncome: 0, amtAdjustment: 0, lots: [], picked: explicit ? "as specified" : "lowest tax first" };
  for (const { lot, shares } of picks) {
    const price = lotPrice(profile, lot, year, sale.price);
    const longTerm = isLongTerm(lot, date);
    const qualifying = isQualifying(lot, date);
    const proceeds = shares * price;
    let ordinary = 0;
    let amtAdjustment = 0;
    if (lot.via === "iso_exercise") {
      if (qualifying === false) ordinary = Math.max(0, Math.min(price, lot.amtBasis) - lot.costBasis) * shares;
      amtAdjustment = -(lot.amtBasis - lot.costBasis) * shares;
    }
    const capitalGain = proceeds - lot.costBasis * shares - ordinary;
    result.lots.push({ lotId: lot.id, label: lot.label, shares, price, costBasis: lot.costBasis, proceeds, ordinaryIncome: ordinary, capitalGain, longTerm, qualifying, amtAdjustment });
    result.shares += shares;
    result.proceeds += proceeds;
    result.ordinaryIncome += ordinary;
    result.amtAdjustment += amtAdjustment;
    if (longTerm) result.longTermGain += capitalGain; else result.shortTermGain += capitalGain;
    lot.quantity -= shares;
  }
  return { remaining: remaining.filter((l) => l.quantity > 0), result };
}

/** Dates on which held lots change character, for the "wait until" hints. */
export interface LotMilestone { lotId: string; label: string; shares: number; date: string; becomes: "long-term" | "qualifying"; }

export function lotMilestones(lots: Lot[], asOf: string): LotMilestone[] {
  const out: LotMilestone[] = [];
  for (const l of lots) {
    if (l.quantity <= 0) continue;
    if (!isLongTerm(l, asOf)) out.push({ lotId: l.id, label: l.label, shares: l.quantity, date: longTermFrom(l.acquired), becomes: "long-term" });
    if (l.via === "iso_exercise" && isQualifying(l, asOf) === false) {
      const q = qualifyingFrom(l);
      if (q !== longTermFrom(l.acquired) || isLongTerm(l, asOf)) out.push({ lotId: l.id, label: l.label, shares: l.quantity, date: q, becomes: "qualifying" });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const sharesHeld = (lots: Lot[]) => lots.reduce((s, l) => s + l.quantity, 0);
