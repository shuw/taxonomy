export type FilingStatus = "single" | "mfj" | "mfs" | "hoh";

/** The human-edited profile file (data/profile.yaml). */
export interface Profile {
  version: 1;
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
  equity: {
    isoGrants: IsoGrant[];
    /** Minimum tax credit already banked from prior years' AMT, entering startYear. */
    amtCreditCarryforward?: number;
  };
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

export interface IsoGrant {
  name: string;
  /** Exercise price per share. */
  strike: number;
  /** Fair market value per share at plan.startYear; grows by assumptions.fmvGrowth. */
  fmv: number;
  /** Shares exercisable over the plan (vesting is not modeled yet). */
  shares: number;
}

/** Everything the user turns. Keyed by year where it varies. */
export interface Levers {
  /** ISO shares exercised in each plan year. Shares are drawn from grants in the order listed. */
  isoExercises: Record<number, number>;
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
  /** Sum over exercised shares of (FMV - strike). */
  isoBargainElement: number;
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
