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

/** The last filed return: inputs as reported, and the results to reproduce. */
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

export interface EquityGrant {
  name: string;
  type: GrantType;
  owner?: Owner;
  grantDate?: string;
  /** Shares originally granted, for the record. */
  granted?: number;
  /** Shares still in play: for options, unexercised (vested or not); for RSUs, all units. */
  shares: number;
  /** Exercise price per share. Options only. */
  strike?: number;
  /** Per-share value at plan.startYear; defaults to equity.sharePrice. */
  fmv?: number;
  /** Shares already vested at the start of the plan (options: vested and still unexercised). Overrides the schedule for the past. */
  vested?: number;
  /** Shares vesting in each plan year, when you would rather state it than derive it. */
  vesting?: Record<number, number>;
  /** Derive per-year vesting from a schedule instead. */
  schedule?: VestingSchedule;
  expires?: string;
}

/** Shares already owned, kept for the sales lever. */
export interface Holding {
  lot: string;
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
  company?: string;
  /** Per-share value (409A or market) at plan.startYear; grows by assumptions.fmvGrowth. */
  sharePrice: number;
  sharePriceAsOf?: string;
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
  /** Direct mortgage interest figure, used only when no home.mortgage is given. */
  mortgageInterest?: number;
}

/** Everything the user turns. Keyed by year where it varies. */
export interface Levers {
  /** Option shares exercised per year, by grant type. Shares are drawn from grants of that type in profile order. */
  exercises: { iso: Record<number, number>; nso: Record<number, number> };
}

/** The human-edited profile file (data/profiles/<id>.yaml). */
export interface Profile {
  version: 2;
  /** Display name; the file name is the id. */
  name?: string;
  filer: {
    filingStatus: FilingStatus;
    state: string; // two-letter code; "WA" is the only one modeled so far
    dependents?: number;
  };
  plan: {
    startYear: number;
    years: number;
  };
  assumptions: {
    /** Annual CPI assumption used to index bracket edges, exemptions and caps past the last published year. */
    inflation: number;
    /** Annual growth applied to salaries. */
    wageGrowth: number;
    /** Annual growth applied to the company share value. */
    fmvGrowth: number;
  };
  people: { self: Person; spouse?: Person };
  income: Income;
  carryforwards?: Carryforwards;
  priorReturn?: PriorReturn;
  equity: Equity;
  home?: Home;
  deductions?: Deductions;
  /** Default lever positions. The UI starts here. */
  levers?: Partial<Levers>;
  /** Where numbers came from, keyed by profile path ("people.self.salary": "pay stub 2026-08-31"). */
  sources?: Record<string, string>;
}

/** Fully resolved inputs for one tax year, after profile defaults, growth and levers are applied. */
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
  /** Interest actually paid this year on home.mortgage, or the direct deductions figure. */
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
