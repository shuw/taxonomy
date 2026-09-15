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

/** Everything the user turns. Keyed by year where it varies. */
export interface Levers {
  /** Option shares exercised per year, by grant type. Shares are drawn from grants of that type in profile order. */
  exercises: { iso: Record<number, number>; nso: Record<number, number> };
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
  /** Named lever settings. */
  scenarios?: Record<string, Levers>;
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
  amtCreditCarryforwardIn: number;
  /** Added to every ordinary bracket rate this year. */
  bracketRateDelta: number;
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
