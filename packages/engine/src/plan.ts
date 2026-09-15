import { computeFederal } from "./federal.ts";
import { exerciseSpread, rsuVesting, sharesExercisable } from "./equity.ts";
import { Ledger, pct, usd } from "./ledger.ts";
import { amortize, type MortgageYear } from "./mortgage.ts";
import { federalParams } from "./params.ts";
import { stateModule } from "./state/index.ts";
import { activeLevers, profileInYear } from "./timeline.ts";
import type { Levers, PlanResult, Profile, YearInputs, YearResult } from "./types.ts";

export function planYears(profile: Profile): number[] {
  return Array.from({ length: profile.plan.years }, (_, i) => profile.plan.startYear + i);
}

/** The active scenario's levers with overrides on top. */
export function resolveLevers(profile: Profile, overrides?: Partial<Levers>): Levers {
  const base = activeLevers(profile);
  return {
    exercises: {
      iso: { ...base.exercises.iso, ...(overrides?.exercises?.iso ?? {}) },
      nso: { ...base.exercises.nso, ...(overrides?.exercises?.nso ?? {}) },
    },
  };
}

/** Balances that flow from one plan year into the next. */
export interface Carries {
  amtCredit: number;
  capitalLoss: { shortTerm: number; longTerm: number };
  charitable: number;
}

export function openingCarries(profile: Profile): Carries {
  const c = profile.carryforwards ?? {};
  return {
    amtCredit: c.amtCredit ?? 0,
    capitalLoss: { shortTerm: c.capitalLoss?.shortTerm ?? 0, longTerm: c.capitalLoss?.longTerm ?? 0 },
    charitable: c.charitable ?? 0,
  };
}

/**
 * Inputs for one year. `profile` should already be the timeline-adjusted profile for that year
 * (see profileInYear); growth assumptions compound from plan.startYear.
 */
export function yearInputs(profile: Profile, levers: Levers, year: number, carries: Carries, mortgage?: MortgageYear): YearInputs {
  const t = year - profile.plan.startYear;
  const grow = (x: number) => x * (1 + profile.assumptions.wageGrowth) ** t;
  const self = profile.people.self;
  const spouse = profile.people.spouse;
  const inc = profile.income;
  const ded = profile.deductions ?? {};
  const ch = ded.charitable ?? {};
  const iso = Math.min(levers.exercises.iso[year] ?? 0, sharesExercisable(profile, levers, "iso", year));
  const nso = Math.min(levers.exercises.nso[year] ?? 0, sharesExercisable(profile, levers, "nso", year));
  const rsu = rsuVesting(profile, year);
  const ordinaryDividends = inc.ordinaryDividends ?? inc.qualifiedDividends ?? 0;
  const qualified = inc.qualifiedDividends ?? 0;
  return {
    year,
    filingStatus: profile.filer.filingStatus,
    state: profile.filer.state,
    salarySelf: grow(self.salary + (self.bonus ?? 0)),
    salarySpouse: spouse ? grow(spouse.salary + (spouse.bonus ?? 0)) : 0,
    pretaxContributions: (self.pretaxContributions ?? 0) + (spouse?.pretaxContributions ?? 0),
    otherOrdinary: inc.otherOrdinary ?? 0,
    interest: inc.interest ?? 0,
    nonqualifiedDividends: Math.max(0, ordinaryDividends - qualified),
    qualifiedDividends: qualified,
    longTermGains: inc.longTermGains ?? 0,
    shortTermGains: inc.shortTermGains ?? 0,
    capitalLossCarryIn: carries.capitalLoss,
    mortgageInterestPaid: mortgage ? mortgage.interestPaid : profile.home?.mortgageInterest ?? 0,
    mortgageCapFraction: mortgage ? mortgage.capFraction : 1,
    propertyTax: profile.home?.propertyTax ?? 0,
    stateIncomeTax: ded.stateIncomeTax ?? 0,
    charitableCash: (ch.cash ?? 0) + (ch.daf ?? 0),
    charitableStock: ch.appreciatedStock ?? 0,
    charitableCarryIn: carries.charitable,
    medical: ded.medical ?? 0,
    isoSharesExercised: iso,
    isoBargainElement: exerciseSpread(profile, levers, "iso", year, iso),
    nsoSharesExercised: nso,
    nsoIncome: exerciseSpread(profile, levers, "nso", year, nso),
    rsuSharesVested: rsu.shares,
    rsuIncome: rsu.income,
    amtCreditCarryforwardIn: carries.amtCredit,
    bracketRateDelta: profile.assumptions.bracketRateDelta ?? 0,
  };
}

export function computeYear(profile: Profile, inputs: YearInputs): YearResult {
  const ledger = new Ledger();
  const params = federalParams(inputs.year, profile.assumptions.inflation, inputs.bracketRateDelta);
  computeFederal(inputs, params, ledger);
  stateModule(inputs.state).compute(inputs, ledger, { inflation: profile.assumptions.inflation, policy: profile.assumptions.state ?? {}, agi: ledger.get("agi") });
  const total = ledger.put("totalTax", "Total tax", ledger.get("federalTotal") + ledger.get("stateTax"), "Federal + state.", ["federalTotal", "stateTax"]);
  const agi = ledger.get("agi");
  ledger.put("effectiveRate", "Effective rate", agi > 0 ? total / agi : 0, `Total tax as a share of AGI (${usd(agi)}). ISO bargain element is not in AGI, so an exercise year can look expensive by this measure.`, ["totalTax", "agi"], "rate");
  return { year: inputs.year, inputs, lines: ledger.lines, order: ledger.order };
}

function carriesOut(result: YearResult): Carries {
  const v = (id: string) => result.lines[id]?.value ?? 0;
  return {
    amtCredit: v("amtCreditCarryforwardOut"),
    capitalLoss: { shortTerm: v("capitalLossCarryOutShortTerm"), longTerm: v("capitalLossCarryOutLongTerm") },
    charitable: v("charitableCarryOut"),
  };
}

/** Run every plan year in sequence: the timeline shapes each year's facts, carryforwards thread through. */
export function runPlan(profile: Profile, leverOverrides?: Partial<Levers>): PlanResult {
  const levers = resolveLevers(profile, leverOverrides);
  let carries = openingCarries(profile);
  const years: YearResult[] = [];
  let mortgage: MortgageYear[] | null = null;
  let mortgageKey = "";
  for (const [i, year] of planYears(profile).entries()) {
    const p = profileInYear(profile, year);
    // Re-amortize only when the loan itself changes on the timeline.
    const key = JSON.stringify(p.home?.mortgage ?? null);
    if (key !== mortgageKey) {
      mortgageKey = key;
      mortgage = p.home?.mortgage ? amortize(p.home.mortgage, year, profile.plan.years - i) : null;
      if (mortgage) mortgage = [...Array(i).fill(undefined), ...mortgage];
    }
    const result = computeYear(p, yearInputs(p, levers, year, carries, mortgage?.[i]));
    carries = carriesOut(result);
    years.push(result);
  }
  const sum = (id: string) => years.reduce((s, y) => s + y.lines[id]!.value, 0);
  return {
    years,
    totals: { totalTax: sum("totalTax"), federalTotal: sum("federalTotal"), stateTax: sum("stateTax"), amt: sum("amt"), amtCreditCarryforwardEnd: carries.amtCredit },
  };
}

export { pct, usd };
