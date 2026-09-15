import { computeFederal } from "./federal.ts";
import { Ledger } from "./ledger.ts";
import { federalParams } from "./params.ts";
import type { PriorReturn, Profile, YearInputs } from "./types.ts";

export interface CalibrationRow {
  id: string;
  label: string;
  reported: number;
  computed: number;
  delta: number;
}

export interface Calibration {
  year: number;
  rows: CalibrationRow[];
  /** Ids of lines the engine could not compare because the return did not report them. */
  missing: string[];
  ledger: Ledger;
}

const COMPARED: [keyof PriorReturn["reported"], string][] = [
  ["agi", "agi"],
  ["taxableIncome", "taxableIncome"],
  ["regularTax", "regularTax"],
  ["amti", "amti"],
  ["amtExemption", "amtExemption"],
  ["tentativeMinimumTax", "tentativeMinimumTax"],
  ["amt", "amt"],
  ["amtCreditUsed", "amtCreditUsed"],
  ["niit", "niit"],
  ["additionalMedicare", "additionalMedicare"],
  ["totalTax", "federalTotal"],
];

/**
 * Recompute the last filed return from the inputs it reported and compare line by line.
 * Wages on a return are already W-2 box 1, so pre-tax contributions, RSU and NSO income are
 * folded in and not separated; itemized amounts are taken as reported.
 */
export function latestReturn(profile: Profile): PriorReturn | undefined {
  return [...(profile.returns ?? [])].sort((a, b) => b.year - a.year)[0];
}

export function calibrate(profile: Profile): Calibration | null {
  const pr = latestReturn(profile);
  if (!pr) return null;
  const inp = pr.inputs;
  const ordinaryDividends = inp.ordinaryDividends ?? inp.qualifiedDividends ?? 0;
  const inputs: YearInputs = {
    year: pr.year,
    filingStatus: pr.filingStatus ?? profile.filer.filingStatus,
    state: profile.filer.state,
    salarySelf: inp.wages ?? 0,
    salarySpouse: 0,
    pretaxContributions: 0,
    otherOrdinary: inp.otherIncome ?? 0,
    interest: inp.interest ?? 0,
    nonqualifiedDividends: Math.max(0, ordinaryDividends - (inp.qualifiedDividends ?? 0)),
    qualifiedDividends: inp.qualifiedDividends ?? 0,
    longTermGains: inp.longTermGains ?? 0,
    shortTermGains: inp.shortTermGains ?? 0,
    capitalLossCarryIn: { shortTerm: 0, longTerm: 0 },
    mortgageInterestPaid: inp.itemized?.mortgageInterest ?? 0,
    mortgageCapFraction: 1,
    propertyTax: inp.itemized?.salt ?? 0,
    stateIncomeTax: 0,
    charitableCash: inp.itemized?.charitable ?? 0,
    charitableStock: 0,
    charitableCarryIn: 0,
    medical: inp.itemized?.other ?? 0,
    isoSharesExercised: 0,
    isoBargainElement: inp.isoBargainElement ?? 0,
    nsoSharesExercised: 0,
    nsoIncome: 0,
    rsuSharesVested: 0,
    rsuIncome: 0,
    amtCreditCarryforwardIn: inp.amtCreditCarriedIn ?? 0,
    bracketRateDelta: 0,
    medicareWages: inp.medicareWages,
  };
  const ledger = new Ledger();
  computeFederal(inputs, federalParams(pr.year, profile.assumptions.inflation), ledger);
  const rows: CalibrationRow[] = [];
  const missing: string[] = [];
  for (const [reportedKey, lineId] of COMPARED) {
    const reported = pr.reported[reportedKey];
    const line = ledger.lines[lineId];
    if (!line) continue;
    if (reported === undefined) { missing.push(lineId); continue; }
    rows.push({ id: lineId, label: line.label, reported, computed: line.value, delta: line.value - reported });
  }
  return { year: pr.year, rows, missing, ledger };
}
