export type FilingStatus = "single" | "mfj" | "mfs" | "hoh";
export type Owner = "self" | "spouse";

/** One earner. Amounts are annual, for plan.startYear. */
export interface Person {
  name?: string;
  /** Base pay. RSU vests and NSO exercises are added by the engine, so do not include them here. */
  salary: number;
  bonus?: number;
  /** Pre-tax 401(k), HSA and similar: they reduce taxable wages but not Medicare wages. */
  pretaxContributions?: number;
  /** Federal income tax withheld so far this year (stored for a cash view; not used in the tax math yet). */
  withholdingToDate?: number;
}

export interface Dependent {
  name?: string;
  birthYear?: number;
}

export interface Income {
  otherOrdinary?: number;
  interest?: number;
  /** Total dividends (1099-DIV box 1a). The non-qualified part is taxed as ordinary income. */
  ordinaryDividends?: number;
  /** 1099-DIV box 1b; taxed at capital gain rates. */
  qualifiedDividends?: number;
  shortTermGains?: number;
  longTermGains?: number;
}

export interface Carryforwards {
  /** Minimum tax credit (Form 8801) entering plan.startYear. */
  amtCredit?: number;
  capitalLoss?: { shortTerm?: number; longTerm?: number };
  /** Charitable contributions not yet deducted because of AGI limits. */
  charitable?: number;
}

/** A filed return: inputs as reported, and the results to reproduce. */
export interface PriorReturn {
  year: number;
  filingStatus?: FilingStatus;
  inputs: {
    wages?: number;
    interest?: number;
    ordinaryDividends?: number;
    qualifiedDividends?: number;
    shortTermGains?: number;
    longTermGains?: number;
    otherIncome?: number;
    itemized?: { salt?: number; mortgageInterest?: number; charitable?: number; other?: number };
    /** Form 6251 line 2i. */
    isoBargainElement?: number;
    /** Form 8801 credit available at the start of that year. */
    amtCreditCarriedIn?: number;
    /** W-2 box 5, summed across W-2s; the base for the additional Medicare tax. */
    medicareWages?: number;
  };
  reported: {
    agi?: number;
    taxableIncome?: number;
    regularTax?: number;
    amti?: number;
    amtExemption?: number;
    tentativeMinimumTax?: number;
    amt?: number;
    amtCreditUsed?: number;
    niit?: number;
    /** Form 8959 line 18. */
    additionalMedicare?: number;
    /** 1040 line 24. */
    totalTax?: number;
  };
}

/** An issuer of equity: an employer, or any stock you hold. */
export interface Company {
  id: string;
  name: string;
  /** Per-share value (409A or market) at plan.startYear. */
  sharePrice: number;
  sharePriceAsOf?: string;
  /** Annual growth for this company; defaults to assumptions.fmvGrowth. */
  growth?: number;
  /** Known or assumed prices in specific years (an IPO, a tender). Later years grow from the last point. */
  pricePath?: Record<number, number>;
  /** Year of the liquidity event that settles double-trigger RSUs (an IPO or acquisition). Unset means none in the plan. */
  liquidityYear?: number;
}

export type GrantType = "iso" | "nso" | "rsu";

/** A vesting schedule the engine expands into per-year vest counts. */
export interface VestingSchedule {
  /** Vesting commencement date, YYYY-MM-DD. */
  start: string;
  /** Total vesting period in years. */
  years: number;
  /** Months before the first vest; everything accrued by then vests at once. */
  cliffMonths?: number;
  cadence?: "monthly" | "quarterly" | "annual";
}

/**
 * A grant is described by the same three counts every portal shows: granted, vested to date,
 * exercised to date. What is exercisable, and what still vests, is derived.
 */
export interface EquityGrant {
  id: string;
  name: string;
  type: GrantType;
  /** Company id; defaults to the first company. */
  company?: string;
  owner?: Owner;
  grantDate?: string;
  /** Shares or units originally granted. */
  granted: number;
  /** Shares vested as of `countsAsOf` (for RSUs: already delivered). Overrides the schedule for the past. */
  vestedToDate?: number;
  /** Option shares exercised as of `countsAsOf`; gone from this grant (their shares live in holdings). */
  exercisedToDate?: number;
  /** The date the counts above were read (a portal shows today's numbers). Defaults to the plan's first day. Schedule vests after this date are added on top. */
  countsAsOf?: string;
  /** Exercise price per share. Options only. */
  strike?: number;
  /** Shares vesting in each plan year, when you would rather state it than derive it. */
  vesting?: Record<number, number>;
  /** Derive per-year vesting from a schedule instead. */
  schedule?: VestingSchedule;
  expires?: string;
  /** RSUs only. "vest" (default): income when units vest. "liquidity": double-trigger; time-vested units become income in the company's liquidity year. */
  settlement?: "vest" | "liquidity";
}

/** Shares already owned, kept for the sales lever. */
export interface Holding {
  id: string;
  lot: string;
  company?: string;
  owner?: Owner;
  quantity: number;
  acquired: string;
  via: "iso_exercise" | "nso_exercise" | "rsu_vest" | "espp" | "purchase" | "other";
  /** Regular cost basis per share. */
  costBasis: number;
  /** AMT basis per share (FMV at exercise for ISO shares). */
  amtBasis?: number;
  /** ISO shares: the option's grant date, for the two-year holding test. */
  grantDate?: string;
}

export interface Equity {
  companies: Company[];
  grants: EquityGrant[];
  holdings?: Holding[];
}

export interface Mortgage {
  /** Outstanding principal at plan.startYear. */
  balance: number;
  /** Annual interest rate as a fraction. */
  rate: number;
  originated: string;
  /** Original loan amount; with the origination date it decides the acquisition-debt cap. */
  originalAmount?: number;
  termYears?: number;
}

export interface Home {
  mortgage?: Mortgage;
  /** Direct interest figure, used only when no mortgage is given. */
  mortgageInterest?: number;
  propertyTax?: number;
}

export interface Charitable {
  cash?: number;
  /** Fair market value of appreciated securities given. */
  appreciatedStock?: number;
  /** Contributions to a donor-advised fund (treated as cash). */
  daf?: number;
}

export interface Deductions {
  stateIncomeTax?: number;
  charitable?: Charitable;
  medical?: number;
}

/** A decision placed on the plan's timeline. Facts live elsewhere; these are the things you can change your mind about. */
export type ScenarioEvent =
  | {
      id: string;
      kind: "exercise";
      year: number;
      /** YYYY-MM-DD when it matters for holding periods; defaults to January 1 of the year. */
      date?: string;
      type: "iso" | "nso";
      /** Company id; defaults to the first company. Shares are drawn from that company's grants of this type, in profile order. */
      company?: string;
      shares: number;
    }
  | {
      id: string;
      kind: "sell";
      year: number;
      /** Defaults to December 31 of the year. */
      date?: string;
      shares: number;
      /** Per-share price; defaults to the company's modeled price for the year. */
      price?: number;
      /** Specific lots, lot id to shares; when absent, lots are picked lowest tax first. */
      lots?: Record<string, number>;
    }
  | {
      id: string;
      kind: "liquidity";
      year: number;
      date?: string;
      /** Company id; defaults to every company. */
      company?: string;
      /** Share price at the event; sets that year's price. Defaults to the modeled price. */
      price?: number;
    };

/** One sale as the engine sees it. */
export interface SaleLever {
  id: string;
  shares: number;
  date?: string;
  price?: number;
  lots?: Record<string, number>;
}

/** A named list of decisions. */
export interface Scenario {
  events: ScenarioEvent[];
}

/** The per-year lever table the engine computes from; derived from a scenario's events. */
export interface Levers {
  /** Option shares exercised per year, by grant type, then by company id. */
  exercises: { iso: Record<number, Record<string, number>>; nso: Record<number, Record<string, number>> };
  /** Exercise dates per year and type when set on the event; January 1 otherwise. */
  exerciseDates?: { iso: Record<number, string>; nso: Record<number, string> };
  /** Sales per year, in date order. */
  sales?: Record<number, SaleLever[]>;
  /** Liquidity events by company id ("*" for all): the year settles double-trigger RSUs and the price, if given, pins that year's share price. */
  liquidity?: Record<string, { year: number; price?: number }>;
}

/** A dated change to any profile value, in force from that year on. */
export interface TimelineEntry {
  year: number;
  /** Dot path into the profile, e.g. "people.self.salary" or "filer.filingStatus". */
  path: string;
  value: unknown;
  note?: string;
}

export interface Assumptions {
  /** Annual CPI assumption used to index bracket edges, exemptions and caps past the last published year. */
  inflation: number;
  /** Annual growth applied to salaries. */
  wageGrowth: number;
  /** Default annual growth for company share values. */
  fmvGrowth: number;
  /** Added to every ordinary bracket rate (0.02 raises 37% to 39%). Put it on the timeline to model a future law change. */
  bracketRateDelta?: number;
  /** State-level switches: enacted taxes you may want to turn off to see their effect, and proposals you may want to turn on. */
  state?: StatePolicy;
}

export interface StatePolicy {
  /** Washington capital gains excise tax, 7% on long-term gains over the deduction (enacted 2021). Default on. */
  waCapitalGainsTax?: boolean;
  /** Washington's additional 2.9% on gains over $1M (SB 5813, 2025). Default on. */
  waCapitalGainsSurtax?: boolean;
  /** Washington's millionaires' tax (SB 6346, signed March 2026): 9.9% on income over a $1M household deduction, from tax year 2028. Default on; switch off to model repeal or a court loss. */
  waMillionairesTax?: boolean;
}

export type Source = string | { doc: string; asOf?: string; note?: string };

/** Something the intake agent asked you to confirm, kept until you mark it done. */
export interface FollowUp {
  id: string;
  text: string;
  /** Profile path it concerns, when known ("carryforwards.amtCredit", "grants.g1"). */
  about?: string;
  /** "missing": a required fact nobody supplied yet; answered inline. "confirm" (default): a judgment call to double-check. */
  kind?: "confirm" | "missing";
  resolved?: boolean;
  added?: string;
}

/** The human-edited profile file (data/profiles/<id>.yaml). */
export interface Profile {
  version: 3;
  /** Display name; the file name is the id. */
  name?: string;
  filer: {
    filingStatus: FilingStatus;
    state: string; // two-letter code; "WA" is the only one modeled so far
    dependents?: Dependent[];
  };
  plan: {
    startYear: number;
    years: number;
  };
  assumptions: Assumptions;
  people: { self: Person; spouse?: Person };
  income: Income;
  carryforwards?: Carryforwards;
  /** Filed returns, newest used for calibration. */
  returns?: PriorReturn[];
  equity: Equity;
  home?: Home;
  deductions?: Deductions;
  /** Dated changes to the facts above. */
  timeline?: TimelineEntry[];
  /** Named lists of decisions. */
  scenarios?: Record<string, Scenario>;
  activeScenario?: string;
  /** Where numbers came from, keyed by profile path ("people.self.salary"); grants and holdings by id ("grants.g1"). */
  sources?: Record<string, Source>;
  followUps?: FollowUp[];
}

/** Fully resolved inputs for one tax year, after profile defaults, growth, the timeline and levers are applied. */
export interface YearInputs {
  year: number;
  filingStatus: FilingStatus;
  state: string;
  /** Salary plus bonus per person, before pre-tax contributions. */
  salarySelf: number;
  salarySpouse: number;
  pretaxContributions: number;
  otherOrdinary: number;
  interest: number;
  /** Dividends taxed as ordinary income (total minus qualified). */
  nonqualifiedDividends: number;
  qualifiedDividends: number;
  longTermGains: number;
  shortTermGains: number;
  capitalLossCarryIn: { shortTerm: number; longTerm: number };
  /** Interest actually paid this year on home.mortgage, or the direct figure. */
  mortgageInterestPaid: number;
  /** Share of that interest attributable to debt under the acquisition-debt cap (0..1). */
  mortgageCapFraction: number;
  propertyTax: number;
  stateIncomeTax: number;
  charitableCash: number;
  charitableStock: number;
  charitableCarryIn: number;
  medical: number;
  isoSharesExercised: number;
  /** Sum over exercised ISO shares of (FMV - strike): an AMT preference, invisible to regular tax. */
  isoBargainElement: number;
  nsoSharesExercised: number;
  /** Sum over exercised NSO shares of (FMV - strike): ordinary wage income. */
  nsoIncome: number;
  rsuSharesVested: number;
  /** RSU shares vesting this year x FMV: ordinary wage income. */
  rsuIncome: number;
  /** Shares sold this year. */
  sharesSold: number;
  saleProceeds: number;
  /** ISO shares sold before the holding periods: the spread at exercise, taxed as ordinary income (not wages for Medicare). */
  isoDisqualifyingIncome: number;
  /** Added to AMTI for ISO shares sold: the AMT gain is smaller than the regular gain because the AMT basis is higher. Negative. */
  amtCapitalAdjustment: number;
  amtCreditCarryforwardIn: number;
  /** Added to every ordinary bracket rate this year. */
  bracketRateDelta: number;
  /** When set, the additional Medicare tax is computed on this instead of salary plus equity income (a W-2 box 5 figure). */
  medicareWages?: number;
}

/** One number on screen, with the reason it is what it is. */
export interface Line {
  id: string;
  label: string;
  value: number;
  unit: "usd" | "rate" | "shares" | "flag";
  why: string;
  /** Ids of the lines this one was computed from. */
  deps: string[];
}

export interface YearResult {
  year: number;
  inputs: YearInputs;
  lines: Record<string, Line>;
  /** Ordered ids, in computation order, for display. */
  order: string[];
  /** Shares held after this year's exercises and settlements, before its sales. */
  lotsBefore?: import("./lots.ts").Lot[];
  /** Shares held at the end of the year. */
  lotsEnd?: import("./lots.ts").Lot[];
  sales?: import("./lots.ts").SaleResult[];
}

export interface PlanResult {
  years: YearResult[];
  totals: {
    totalTax: number;
    federalTotal: number;
    stateTax: number;
    amt: number;
    amtCreditCarryforwardEnd: number;
  };
}
