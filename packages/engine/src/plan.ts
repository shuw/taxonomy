import { computeFederal } from "./federal.ts";
import { exerciseSpread, rsuVesting, sharesExercisable } from "./equity.ts";
import { Ledger, pct, usd } from "./ledger.ts";
import { federalParams } from "./params.ts";
import { stateModule } from "./state/index.ts";
import type { Levers, PlanResult, Profile, YearInputs, YearResult } from "./types.ts";

export function planYears(profile: Profile): number[] {
  return Array.from({ length: profile.plan.years }, (_, i) => profile.plan.startYear + i);
}

export function resolveLevers(profile: Profile, overrides?: Partial<Levers>): Levers {
  const base = profile.levers?.exercises;
  return {
    exercises: {
      iso: { ...(base?.iso ?? {}), ...(overrides?.exercises?.iso ?? {}) },
      nso: { ...(base?.nso ?? {}), ...(overrides?.exercises?.nso ?? {}) },
    },
  };
}

export function yearInputs(profile: Profile, levers: Levers, year: number, carryIn: number): YearInputs {
  const t = year - profile.plan.startYear;
  const inc = profile.income;
  const ded = profile.deductions;
  const iso = Math.min(levers.exercises.iso[year] ?? 0, sharesExercisable(profile, levers, "iso", year));
  const nso = Math.min(levers.exercises.nso[year] ?? 0, sharesExercisable(profile, levers, "nso", year));
  const rsu = rsuVesting(profile, year);
  return {
    year,
    filingStatus: profile.filer.filingStatus,
    state: profile.filer.state,
    wages: inc.wages * (1 + profile.assumptions.wageGrowth) ** t,
    otherOrdinary: inc.otherOrdinary ?? 0,
    interest: inc.interest ?? 0,
    qualifiedDividends: inc.qualifiedDividends ?? 0,
    longTermGains: inc.longTermGains ?? 0,
    shortTermGains: inc.shortTermGains ?? 0,
    mortgageInterest: ded.mortgageInterest ?? 0,
    propertyTax: ded.propertyTax ?? 0,
    stateIncomeTax: ded.stateIncomeTax ?? 0,
    charitable: ded.charitable ?? 0,
    isoSharesExercised: iso,
    isoBargainElement: exerciseSpread(profile, levers, "iso", year, iso),
    nsoSharesExercised: nso,
    nsoIncome: exerciseSpread(profile, levers, "nso", year, nso),
    rsuSharesVested: rsu.shares,
    rsuIncome: rsu.income,
    amtCreditCarryforwardIn: carryIn,
  };
}

export function computeYear(profile: Profile, inputs: YearInputs): YearResult {
  const ledger = new Ledger();
  const params = federalParams(inputs.year, profile.assumptions.inflation);
  computeFederal(inputs, params, ledger);
  stateModule(inputs.state).compute(inputs, ledger, profile.assumptions.inflation);
  const total = ledger.put("totalTax", "Total tax", ledger.get("federalTotal") + ledger.get("stateTax"), "Federal + state.", ["federalTotal", "stateTax"]);
  const agi = ledger.get("agi");
  ledger.put("effectiveRate", "Effective rate", agi > 0 ? total / agi : 0, `Total tax as a share of AGI (${usd(agi)}). ISO bargain element is not in AGI, so an exercise year can look expensive by this measure.`, ["totalTax", "agi"], "rate");
  return { year: inputs.year, inputs, lines: ledger.lines, order: ledger.order };
}

/** Run every plan year in sequence, threading the AMT credit carryforward through. */
export function runPlan(profile: Profile, leverOverrides?: Partial<Levers>): PlanResult {
  const levers = resolveLevers(profile, leverOverrides);
  let carry = profile.equity.amtCreditCarryforward ?? 0;
  const years: YearResult[] = [];
  for (const year of planYears(profile)) {
    const result = computeYear(profile, yearInputs(profile, levers, year, carry));
    carry = result.lines.amtCreditCarryforwardOut!.value;
    years.push(result);
  }
  const sum = (id: string) => years.reduce((s, y) => s + y.lines[id]!.value, 0);
  return {
    years,
    totals: { totalTax: sum("totalTax"), federalTotal: sum("federalTotal"), stateTax: sum("stateTax"), amt: sum("amt"), amtCreditCarryforwardEnd: carry },
  };
}

export { pct, usd };
