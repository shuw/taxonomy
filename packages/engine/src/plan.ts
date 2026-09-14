import { computeFederal } from "./federal.ts";
import { Ledger, pct, usd } from "./ledger.ts";
import { federalParams } from "./params.ts";
import { stateModule } from "./state/index.ts";
import type { Levers, PlanResult, Profile, YearInputs, YearResult } from "./types.ts";

export function planYears(profile: Profile): number[] {
  return Array.from({ length: profile.plan.years }, (_, i) => profile.plan.startYear + i);
}

export function resolveLevers(profile: Profile, overrides?: Partial<Levers>): Levers {
  return { isoExercises: { ...(profile.levers?.isoExercises ?? {}), ...(overrides?.isoExercises ?? {}) } };
}

/** FMV per share for a grant in a given plan year. */
export function fmvInYear(profile: Profile, grantFmv: number, year: number): number {
  return grantFmv * (1 + profile.assumptions.fmvGrowth) ** (year - profile.plan.startYear);
}

/** Shares still unexercised at the start of `year`, given the exercise lever. */
export function isoSharesAvailable(profile: Profile, levers: Levers, year: number): number {
  const total = profile.equity.isoGrants.reduce((s, g) => s + g.shares, 0);
  const used = Object.entries(levers.isoExercises).reduce((s, [y, n]) => (Number(y) < year ? s + n : s), 0);
  return Math.max(0, total - used);
}

/**
 * Bargain element for exercising `shares` in `year`: shares are drawn from grants in profile
 * order, after the shares already consumed by earlier years.
 */
export function isoBargainElement(profile: Profile, levers: Levers, year: number, shares: number): number {
  let alreadyUsed = Object.entries(levers.isoExercises).reduce((s, [y, n]) => (Number(y) < year ? s + n : s), 0);
  let remaining = shares;
  let bargain = 0;
  for (const g of profile.equity.isoGrants) {
    const skip = Math.min(g.shares, alreadyUsed);
    alreadyUsed -= skip;
    const take = Math.min(g.shares - skip, remaining);
    if (take > 0) {
      bargain += take * Math.max(0, fmvInYear(profile, g.fmv, year) - g.strike);
      remaining -= take;
    }
  }
  return bargain;
}

export function yearInputs(profile: Profile, levers: Levers, year: number, carryIn: number): YearInputs {
  const t = year - profile.plan.startYear;
  const inc = profile.income;
  const ded = profile.deductions;
  const shares = Math.min(levers.isoExercises[year] ?? 0, isoSharesAvailable(profile, levers, year));
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
    isoSharesExercised: shares,
    isoBargainElement: isoBargainElement(profile, levers, year, shares),
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
