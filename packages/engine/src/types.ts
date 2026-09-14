export type FilingStatus = "single" | "mfj" | "mfs" | "hoh";

/** The human-edited profile file (data/profile.yaml). */
export interface Profile {
  version: 1;
  /** Display name; the file name is the id. */
  name?: string;
  filer: {
    filingStatus: FilingStatus;
    state: string; // two-letter code; "WA" is the only one modeled so far
  };
  plan: {
    startYear: number;
    years: number;
  };
  assumptions: {
    /** Annual CPI assumption used to index bracket edges, exemptions and caps past the last published year. */
    inflation: number;
    /** Annual growth applied to wages. */
    wageGrowth: number;
    /** Annual growth applied to the fair market value of ISO shares (private-company 409A or public price). */
    fmvGrowth: number;
  };
  income: Income;
  deductions: Deductions;
  equity: Equity;
  /** Default lever positions. The UI starts here. */
  levers?: Partial<Levers>;
}

export interface Income {
  wages: number;
  otherOrdinary?: number;
  interest?: number;
  qualifiedDividends?: number;
  longTermGains?: number;
  shortTermGains?: number;
}

export interface Deductions {
  mortgageInterest?: number;
  propertyTax?: number;
  stateIncomeTax?: number;
  charitable?: number;
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
  /** Total shares (or units) in the grant. */
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
}

export interface Equity {
  /** Per-share value (409A or market) at plan.startYear; grows by assumptions.fmvGrowth. */
  sharePrice: number;
  grants: EquityGrant[];
  /** Minimum tax credit already banked from prior years' AMT, entering startYear. */
  amtCreditCarryforward?: number;
}

/** Everything the user turns. Keyed by year where it varies. */
export interface Levers {
  /** Option shares exercised per year, by grant type. Shares are drawn from grants of that type in profile order. */
  exercises: { iso: Record<number, number>; nso: Record<number, number> };
}

/** Fully resolved inputs for one tax year, after profile defaults, growth and levers are applied. */
export interface YearInputs {
  year: number;
  filingStatus: FilingStatus;
  state: string;
  wages: number;
  otherOrdinary: number;
  interest: number;
  qualifiedDividends: number;
  longTermGains: number;
  shortTermGains: number;
  mortgageInterest: number;
  propertyTax: number;
  stateIncomeTax: number;
  charitable: number;
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
