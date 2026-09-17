import type { IntakeSection } from "./intake/apply.ts";

export type FieldType = "usd" | "pct" | "number" | "text" | "date" | "enum" | "year" | "bool";

/**
 * One scalar the profile stores and the intake asks for. This registry is the single source
 * for the intake prompt, the review table labels, the unknown-path mapping and the timeline's
 * field picker.
 */
export interface FieldDef {
  /** Profile dot path. */
  path: string;
  /** Intake dot path; defaults to `path`. */
  intake?: string;
  label: string;
  section: IntakeSection;
  type: FieldType;
  /** Where the number lives, for the prompt comment (form and line). */
  hint?: string;
  /** Literal shown in the request template instead of the type's default. */
  example?: string;
  enum?: string[];
  /** Reviewed as its own row (default). Structured rows (prior return, mortgage) consume the rest. */
  review?: boolean;
  /** Offered in the timeline picker. */
  timeline?: boolean;
  /** Listed first in the request as worth looking hardest for; still reported under `unknown` rather than waited on. */
  required?: boolean;
}

const basics = (f: Omit<FieldDef, "section">): FieldDef => ({ section: "basics", ...f });
const pay = (f: Omit<FieldDef, "section">): FieldDef => ({ section: "pay", ...f });
const person = (who: "self" | "spouse"): FieldDef[] => {
  const L = who === "self" ? "Your" : "Spouse";
  return [
    pay({ path: `people.${who}.name`, intake: `people.${who}.name`, label: `${L} name`, type: "text" }),
    pay({ path: `people.${who}.salary`, intake: `people.${who}.baseSalary`, label: `${L} base salary`, type: "usd", hint: "annual base pay from the latest pay stub or offer letter; not W-2 box 1, which includes equity income", timeline: true, required: who === "self" }),
    pay({ path: `people.${who}.bonus`, intake: `people.${who}.expectedBonus`, label: `${L} expected bonus`, type: "usd", hint: "target bonus for the year if the offer letter or pay stub shows it", timeline: true }),
    pay({ path: `people.${who}.pretaxContributions`, intake: `people.${who}.pretaxContributions`, label: `${L} pre-tax contributions`, type: "usd", hint: "401(k), HSA and similar for the year; W-2 box 12 codes D and W, or pay stub YTD annualized", timeline: true }),
    pay({ path: `people.${who}.withholdingToDate`, intake: `people.${who}.withholdingToDate`, label: `${L} withholding to date`, type: "usd", hint: "federal income tax withheld so far this year, from the pay stub" }),
  ];
};

export const FIELDS: FieldDef[] = [
  basics({ path: "filer.filingStatus", intake: "basics.filingStatus", label: "Filing status", type: "enum", enum: ["single", "mfj", "mfs", "hoh"], hint: "single | mfj | mfs | hoh, from the last return's first page (Form 1040 filing status box)", timeline: true, required: true }),
  basics({ path: "filer.state", intake: "basics.state", label: "State", type: "text", hint: "two-letter code, from the last return's address or a pay stub", timeline: true, required: true }),
  basics({ path: "plan.startYear", label: "First plan year", type: "year" }),
  basics({ path: "plan.years", label: "Years to plan", type: "number" }),
  pay({ path: "filer.dependents", intake: "pay.dependents", label: "Dependents", type: "number", example: "[]", hint: "the dependents claimed on the last return (Form 1040 dependents table) as { name, birthYear } with the year left out when it is not shown; [] if none", required: true }),
  ...person("self"),
  ...person("spouse"),

  { path: "carryforwards.amtCredit", intake: "prior_return.amtCreditCarryforward", label: "AMT credit carryforward", section: "prior_return", type: "usd", hint: "Form 8801 line 26: credit available for the next year; 0 if no Form 8801 was filed", required: true },
  { path: "carryforwards.capitalLoss.shortTerm", intake: "prior_return.capitalLossCarryforward.shortTerm", label: "Short-term capital loss carryforward", section: "prior_return", type: "usd", hint: "Schedule D carryover worksheet" },
  { path: "carryforwards.capitalLoss.longTerm", intake: "prior_return.capitalLossCarryforward.longTerm", label: "Long-term capital loss carryforward", section: "prior_return", type: "usd", hint: "Schedule D carryover worksheet" },
  { path: "carryforwards.charitable", intake: "prior_return.charitableCarryforward", label: "Charitable carryforward", section: "prior_return", type: "usd", hint: "gifts not yet deducted because of AGI limits" },
  { path: "returns.year", intake: "prior_return.year", label: "Return year", section: "prior_return", type: "year", review: false, required: true },
  { path: "returns.filingStatus", intake: "prior_return.filingStatus", label: "Filing status that year", section: "prior_return", type: "enum", enum: ["single", "mfj", "mfs", "hoh"], review: false },
  { path: "returns.reported.agi", intake: "prior_return.agi", label: "AGI", section: "prior_return", type: "usd", hint: "1040 line 11", review: false, required: true },
  { path: "returns.reported.taxableIncome", intake: "prior_return.taxableIncome", label: "Taxable income", section: "prior_return", type: "usd", hint: "1040 line 15", review: false },
  { path: "returns.reported.regularTax", intake: "prior_return.regularTax", label: "Regular tax", section: "prior_return", type: "usd", hint: "1040 line 16", review: false },
  { path: "returns.reported.totalTax", intake: "prior_return.totalTax", label: "Total tax", section: "prior_return", type: "usd", hint: "1040 line 24", review: false, required: true },
  { path: "returns.reported.niit", intake: "prior_return.niit", label: "NIIT", section: "prior_return", type: "usd", hint: "Form 8960 line 17, if any", review: false },
  { path: "returns.reported.additionalMedicare", intake: "prior_return.additionalMedicare", label: "Additional Medicare tax", section: "prior_return", type: "usd", hint: "Form 8959 line 18, if any", review: false },
  { path: "returns.inputs.medicareWages", intake: "prior_return.inputs.medicareWages", label: "Medicare wages that year", section: "prior_return", type: "usd", hint: "W-2 box 5, all W-2s added", review: false },
  { path: "returns.reported.amti", intake: "prior_return.amt.amti", label: "AMTI", section: "prior_return", type: "usd", hint: "Form 6251 line 4; omit the amt block if no 6251 was filed", review: false },
  { path: "returns.reported.amtExemption", intake: "prior_return.amt.exemption", label: "AMT exemption", section: "prior_return", type: "usd", hint: "Form 6251 line 5", review: false },
  { path: "returns.reported.tentativeMinimumTax", intake: "prior_return.amt.tentativeMinimumTax", label: "Tentative minimum tax", section: "prior_return", type: "usd", hint: "Form 6251 line 9", review: false },
  { path: "returns.reported.amt", intake: "prior_return.amt.amt", label: "AMT", section: "prior_return", type: "usd", hint: "Form 6251 line 11", review: false },
  { path: "returns.reported.amtCreditUsed", intake: "prior_return.amt.creditUsed", label: "AMT credit used", section: "prior_return", type: "usd", hint: "Form 8801 line 25", review: false },
  { path: "returns.inputs.itemized.salt", intake: "prior_return.itemized.salt", label: "SALT deducted", section: "prior_return", type: "usd", hint: "Schedule A line 5e; omit itemized if the standard deduction was taken", review: false },
  { path: "returns.inputs.itemized.mortgageInterest", intake: "prior_return.itemized.mortgageInterest", label: "Mortgage interest deducted", section: "prior_return", type: "usd", hint: "Schedule A line 8a", review: false },
  { path: "returns.inputs.itemized.charitable", intake: "prior_return.itemized.charitable", label: "Charitable deducted", section: "prior_return", type: "usd", hint: "Schedule A line 14", review: false },
  { path: "returns.inputs.itemized.other", intake: "prior_return.itemized.other", label: "Other itemized", section: "prior_return", type: "usd", review: false },
  { path: "returns.inputs.wages", intake: "prior_return.inputs.wages", label: "Wages that year", section: "prior_return", type: "usd", hint: "1040 line 1a", review: false, required: true },
  { path: "returns.inputs.interest", intake: "prior_return.inputs.interest", label: "Interest that year", section: "prior_return", type: "usd", hint: "1040 line 2b", review: false },
  { path: "returns.inputs.ordinaryDividends", intake: "prior_return.inputs.ordinaryDividends", label: "Dividends that year", section: "prior_return", type: "usd", hint: "1040 line 3b", review: false },
  { path: "returns.inputs.qualifiedDividends", intake: "prior_return.inputs.qualifiedDividends", label: "Qualified dividends that year", section: "prior_return", type: "usd", hint: "1040 line 3a", review: false },
  { path: "returns.inputs.shortTermGains", intake: "prior_return.inputs.shortTermGains", label: "Short-term gains that year", section: "prior_return", type: "usd", hint: "Schedule D line 7", review: false },
  { path: "returns.inputs.longTermGains", intake: "prior_return.inputs.longTermGains", label: "Long-term gains that year", section: "prior_return", type: "usd", hint: "Schedule D line 15", review: false },
  { path: "returns.inputs.otherIncome", intake: "prior_return.inputs.otherIncome", label: "Other income that year", section: "prior_return", type: "usd", hint: "Schedule 1 total", review: false },
  { path: "returns.inputs.isoBargainElement", intake: "prior_return.inputs.isoBargainElement", label: "ISO bargain element that year", section: "prior_return", type: "usd", hint: "Form 6251 line 2i", review: false },
  { path: "returns.inputs.amtCreditCarriedIn", intake: "prior_return.inputs.amtCreditCarriedIn", label: "AMT credit at the start of that year", section: "prior_return", type: "usd", hint: "Form 8801 line 1", review: false },

  { path: "income.interest", intake: "income.interest", label: "Interest", section: "income", type: "usd", hint: "1099-INT box 1, expected for the year", timeline: true },
  { path: "income.ordinaryDividends", intake: "income.dividends.ordinary", label: "Total dividends", section: "income", type: "usd", hint: "1099-DIV box 1a", timeline: true },
  { path: "income.qualifiedDividends", intake: "income.dividends.qualified", label: "Qualified dividends", section: "income", type: "usd", hint: "1099-DIV box 1b", timeline: true },
  { path: "income.shortTermGains", intake: "income.realizedGains.shortTerm", label: "Short-term gains realized", section: "income", type: "usd", hint: "year to date", timeline: true },
  { path: "income.longTermGains", intake: "income.realizedGains.longTerm", label: "Long-term gains realized", section: "income", type: "usd", timeline: true },
  { path: "income.otherOrdinary", intake: "income.other", label: "Other ordinary income", section: "income", type: "usd", hint: "K-1, rental, side income", timeline: true },

  { path: "equity.companies.0.name", intake: "equity.company", label: "Company", section: "equity", type: "text" },
  { path: "equity.companies.0.sharePrice", intake: "equity.sharePrice.value", label: "Share value now", section: "equity", type: "usd", hint: "per share; 409A for private companies, market price otherwise", required: true },
  { path: "equity.companies.0.sharePriceAsOf", intake: "equity.sharePrice.asOf", label: "Share value date", section: "equity", type: "date" },
  { path: "equity.companies.0.growth", label: "Share value growth for this company", section: "equity", type: "pct", hint: "annual, as a fraction; overrides the general assumption" },

  { path: "home.mortgage.balance", intake: "home.mortgage.balance", label: "Mortgage balance", section: "home", type: "usd", hint: "outstanding principal now (Form 1098 box 2 is the balance at Jan 1)", review: false },
  { path: "home.mortgage.rate", intake: "home.mortgage.rate", label: "Mortgage rate", section: "home", type: "pct", hint: "annual, as a fraction", review: false },
  { path: "home.mortgage.originated", intake: "home.mortgage.originated", label: "Mortgage origination", section: "home", type: "date", hint: "Form 1098 box 3", review: false },
  { path: "home.mortgage.originalAmount", intake: "home.mortgage.originalAmount", label: "Original loan amount", section: "home", type: "usd", review: false },
  { path: "home.mortgage.termYears", intake: "home.mortgage.termYears", label: "Mortgage term", section: "home", type: "number", review: false },
  { path: "home.propertyTax", intake: "home.propertyTax", label: "Property tax", section: "home", type: "usd", hint: "Form 1098 box 10 or the county bill", timeline: true },
  { path: "deductions.stateIncomeTax", intake: "deductions.stateIncomeTax", label: "State income tax", section: "home", type: "usd", hint: "0 in states without one", timeline: true },
  { path: "deductions.charitable.cash", intake: "deductions.charitable.cash", label: "Cash gifts", section: "giving", type: "usd", hint: "expected for the year", timeline: true },
  { path: "deductions.charitable.appreciatedStock", intake: "deductions.charitable.appreciatedStock", label: "Appreciated stock given", section: "giving", type: "usd", hint: "fair market value of securities given", timeline: true },
  { path: "deductions.charitable.daf", intake: "deductions.charitable.daf", label: "Donor-advised fund", section: "giving", type: "usd", timeline: true },
  { path: "deductions.medical", intake: "deductions.medical", label: "Medical expenses", section: "home", type: "usd", timeline: true },

  { path: "assumptions.fmvGrowth", intake: "assumptions.fmvGrowth", label: "Share value growth", section: "assumptions", type: "pct", hint: "annual, as a fraction", timeline: true },
  { path: "assumptions.wageGrowth", intake: "assumptions.wageGrowth", label: "Wage growth", section: "assumptions", type: "pct", timeline: true },
  { path: "assumptions.inflation", intake: "assumptions.inflation", label: "Inflation", section: "assumptions", type: "pct", timeline: true },
  { path: "assumptions.bracketRateDelta", label: "Bracket rate shift", section: "assumptions", type: "pct", hint: "added to every ordinary bracket rate", timeline: true },
  { path: "assumptions.state.waCapitalGainsTax", label: "WA capital gains tax (on/off)", section: "assumptions", type: "bool", timeline: true },
  { path: "assumptions.state.waCapitalGainsSurtax", label: "WA 2.9% surtax over $1M (on/off)", section: "assumptions", type: "bool", timeline: true },
  { path: "assumptions.state.waMillionairesTax", label: "WA millionaires' tax (on/off)", section: "assumptions", type: "bool", timeline: true },
];

export const fieldByPath = (path: string): FieldDef | undefined => FIELDS.find((f) => f.path === path);
export const fieldByIntake = (intake: string): FieldDef | undefined => FIELDS.find((f) => (f.intake ?? f.path) === intake);
export const timelineFields = (): FieldDef[] => FIELDS.filter((f) => f.timeline);
export const requiredFields = (section: IntakeSection): FieldDef[] => FIELDS.filter((f) => f.section === section && f.required);

/** Example value for a field in the prompt template. */
export function exampleValue(f: FieldDef): string {
  if (f.example !== undefined) return f.example;
  switch (f.type) {
    case "usd": case "number": return "0";
    case "bool": return "false";
    case "pct": return "0.0";
    case "year": return String(new Date().getFullYear());
    case "date": return `${new Date().getFullYear()}-01-01`;
    case "enum": return f.enum?.[0] ?? "";
    default: return '""';
  }
}
