import type { FilingStatus } from "./types.ts";

type ByStatus = Record<FilingStatus, number>;

export interface Bracket {
  /** Upper edge of the bracket (taxable income); Infinity for the top bracket. */
  upTo: number;
  rate: number;
}

export interface FederalParams {
  year: number;
  /** false when the numbers are projected from the last published year with the profile's inflation assumption. */
  published: boolean;
  standardDeduction: ByStatus;
  brackets: Record<FilingStatus, Bracket[]>;
  /** Long-term capital gain / qualified dividend rate edges, measured on taxable income. */
  capGains: Record<FilingStatus, { zeroUpTo: number; fifteenUpTo: number }>;
  amt: {
    exemption: ByStatus;
    phaseoutStart: ByStatus;
    /** Exemption lost per dollar of AMTI over phaseoutStart. */
    phaseoutRate: number;
    /** AMT base above which the 28% rate applies (instead of 26%). */
    rateBreak: ByStatus;
    lowRate: number;
    highRate: number;
  };
  niit: { threshold: ByStatus; rate: number };
  additionalMedicare: { threshold: ByStatus; rate: number };
  salt: {
    cap: ByStatus;
    phaseoutStart: ByStatus;
    /** Cap lost per dollar of MAGI over phaseoutStart. */
    phaseoutRate: number;
    floor: ByStatus;
  };
  /** Itemized charitable deduction is reduced by this fraction of AGI (OBBBA, 2026+). */
  charitableAgiFloor: number;
}

const all = (n: number): ByStatus => ({ single: n, mfj: n, mfs: n, hoh: n });

/**
 * Tax year 2026. Sources: Rev. Proc. 2025-32 (inflation adjustments) and the
 * One Big Beautiful Bill Act (P.L. 119-21) for the AMT phaseout, SALT cap and charitable floor.
 */
export const FEDERAL_2026: FederalParams = {
  year: 2026,
  published: true,
  standardDeduction: { single: 16_100, mfj: 32_200, mfs: 16_100, hoh: 24_150 },
  brackets: {
    single: [
      { upTo: 12_400, rate: 0.10 }, { upTo: 50_400, rate: 0.12 }, { upTo: 105_700, rate: 0.22 },
      { upTo: 201_775, rate: 0.24 }, { upTo: 256_225, rate: 0.32 }, { upTo: 640_600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    mfj: [
      { upTo: 24_800, rate: 0.10 }, { upTo: 100_800, rate: 0.12 }, { upTo: 211_400, rate: 0.22 },
      { upTo: 403_550, rate: 0.24 }, { upTo: 512_450, rate: 0.32 }, { upTo: 768_700, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    mfs: [
      { upTo: 12_400, rate: 0.10 }, { upTo: 50_400, rate: 0.12 }, { upTo: 105_700, rate: 0.22 },
      { upTo: 201_775, rate: 0.24 }, { upTo: 256_225, rate: 0.32 }, { upTo: 384_350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    hoh: [
      { upTo: 17_700, rate: 0.10 }, { upTo: 67_450, rate: 0.12 }, { upTo: 105_700, rate: 0.22 },
      { upTo: 201_750, rate: 0.24 }, { upTo: 256_200, rate: 0.32 }, { upTo: 640_600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
  },
  capGains: {
    single: { zeroUpTo: 49_450, fifteenUpTo: 545_500 },
    mfj: { zeroUpTo: 98_900, fifteenUpTo: 613_700 },
    mfs: { zeroUpTo: 49_450, fifteenUpTo: 306_850 },
    hoh: { zeroUpTo: 66_200, fifteenUpTo: 579_600 },
  },
  amt: {
    exemption: { single: 90_100, mfj: 140_200, mfs: 70_100, hoh: 90_100 },
    phaseoutStart: { single: 500_000, mfj: 1_000_000, mfs: 500_000, hoh: 500_000 },
    phaseoutRate: 0.5,
    rateBreak: { single: 244_500, mfj: 244_500, mfs: 122_250, hoh: 244_500 },
    lowRate: 0.26,
    highRate: 0.28,
  },
  niit: { threshold: { single: 200_000, mfj: 250_000, mfs: 125_000, hoh: 200_000 }, rate: 0.038 },
  additionalMedicare: { threshold: { single: 200_000, mfj: 250_000, mfs: 125_000, hoh: 200_000 }, rate: 0.009 },
  salt: {
    cap: { single: 40_400, mfj: 40_400, mfs: 20_200, hoh: 40_400 },
    phaseoutStart: { single: 505_000, mfj: 505_000, mfs: 252_500, hoh: 505_000 },
    phaseoutRate: 0.3,
    floor: { single: 10_000, mfj: 10_000, mfs: 5_000, hoh: 10_000 },
  },
  charitableAgiFloor: 0.005,
};

/** SALT cap schedule written into OBBBA: +1%/yr through 2029, then back to $10,000. */
function saltFor(year: number, status: FilingStatus): { cap: number; phaseoutStart: number } {
  const half = status === "mfs" ? 0.5 : 1;
  if (year >= 2030) return { cap: 10_000 * half, phaseoutStart: Infinity };
  const step = year - 2026; // 2026 -> 0
  return {
    cap: Math.round(40_400 * 1.01 ** step) * half,
    phaseoutStart: Math.round(505_000 * 1.01 ** step) * half,
  };
}

const roundTo = (n: number, step: number): number => (Number.isFinite(n) ? Math.round(n / step) * step : n);

function scaleByStatus(v: ByStatus, f: number, step: number): ByStatus {
  return { single: roundTo(v.single * f, step), mfj: roundTo(v.mfj * f, step), mfs: roundTo(v.mfs * f, step), hoh: roundTo(v.hoh * f, step) };
}

/**
 * Parameters for any plan year. 2026 is published; later years are projected by
 * compounding the profile's inflation assumption from 2026 (the IRS uses chained CPI
 * with its own rounding, so projections are approximate by design).
 */
export function federalParams(year: number, inflation: number): FederalParams {
  const base = FEDERAL_2026;
  if (year <= base.year) return base;
  const f = (1 + inflation) ** (year - base.year);
  const statuses: FilingStatus[] = ["single", "mfj", "mfs", "hoh"];
  const brackets = {} as Record<FilingStatus, Bracket[]>;
  const capGains = {} as FederalParams["capGains"];
  const saltCap = {} as ByStatus;
  const saltStart = {} as ByStatus;
  for (const s of statuses) {
    brackets[s] = base.brackets[s].map((b) => ({ upTo: roundTo(b.upTo * f, 25), rate: b.rate }));
    capGains[s] = { zeroUpTo: roundTo(base.capGains[s].zeroUpTo * f, 50), fifteenUpTo: roundTo(base.capGains[s].fifteenUpTo * f, 50) };
    const salt = saltFor(year, s);
    saltCap[s] = salt.cap;
    saltStart[s] = salt.phaseoutStart;
  }
  return {
    year,
    published: false,
    standardDeduction: scaleByStatus(base.standardDeduction, f, 50),
    brackets,
    capGains,
    amt: {
      ...base.amt,
      exemption: scaleByStatus(base.amt.exemption, f, 100),
      phaseoutStart: scaleByStatus(base.amt.phaseoutStart, f, 100),
      rateBreak: scaleByStatus(base.amt.rateBreak, f, 100),
    },
    niit: base.niit,
    additionalMedicare: base.additionalMedicare,
    salt: { ...base.salt, cap: saltCap, phaseoutStart: saltStart },
    charitableAgiFloor: base.charitableAgiFloor,
  };
}

/** Tax on `amount` under a bracket schedule. */
export function bracketTax(amount: number, brackets: Bracket[]): number {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    if (amount <= lower) break;
    const slice = Math.min(amount, b.upTo) - lower;
    tax += slice * b.rate;
    lower = b.upTo;
  }
  return tax;
}

/** Marginal bracket rate at `amount`. */
export function bracketRate(amount: number, brackets: Bracket[]): number {
  for (const b of brackets) if (amount <= b.upTo) return b.rate;
  return brackets[brackets.length - 1]?.rate ?? 0;
}

/**
 * Tax on preferential income (LTCG + qualified dividends) stacked on top of `ordinary`
 * taxable income, using the 0/15/20 edges.
 */
export function capGainsTax(preferential: number, ordinary: number, edges: { zeroUpTo: number; fifteenUpTo: number }): number {
  const top = ordinary + preferential;
  const at0 = Math.max(0, Math.min(top, edges.zeroUpTo) - ordinary);
  const at15 = Math.max(0, Math.min(top, edges.fifteenUpTo) - Math.max(ordinary, edges.zeroUpTo));
  const at20 = Math.max(0, top - Math.max(ordinary, edges.fifteenUpTo));
  return at15 * 0.15 + at20 * 0.2 + at0 * 0;
}
