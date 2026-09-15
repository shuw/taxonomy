import type { Ledger } from "../ledger.ts";
import { pct, usd } from "../ledger.ts";
import { bracketTax, type Bracket } from "../params.ts";
import type { FilingStatus, YearInputs } from "../types.ts";
import type { StateModule } from "./index.ts";

/**
 * California personal income tax, tax year 2025 parameters indexed forward by the inflation
 * assumption. Capital gains are ordinary income here. The 1% Mental Health Services surtax
 * applies over $1M of taxable income. California's AMT (7%) counts the ISO spread, so an ISO
 * exercise can owe state AMT too. Approximations: federal AGI is used as the starting point,
 * itemized deductions are property tax + mortgage interest + charitable (no SALT), the AMT
 * exemption figures are approximate, and no credits are applied.
 */
const SINGLE_2025: Bracket[] = [
  { upTo: 10_756, rate: 0.01 }, { upTo: 25_499, rate: 0.02 }, { upTo: 40_245, rate: 0.04 }, { upTo: 55_866, rate: 0.06 },
  { upTo: 70_606, rate: 0.08 }, { upTo: 360_659, rate: 0.093 }, { upTo: 432_787, rate: 0.103 }, { upTo: 721_314, rate: 0.113 },
  { upTo: Infinity, rate: 0.123 },
];
const HOH_2025: Bracket[] = [
  { upTo: 21_527, rate: 0.01 }, { upTo: 51_000, rate: 0.02 }, { upTo: 65_744, rate: 0.04 }, { upTo: 81_364, rate: 0.06 },
  { upTo: 96_107, rate: 0.08 }, { upTo: 490_493, rate: 0.093 }, { upTo: 588_593, rate: 0.103 }, { upTo: 980_987, rate: 0.113 },
  { upTo: Infinity, rate: 0.123 },
];
const STANDARD_2025: Record<FilingStatus, number> = { single: 5_540, mfs: 5_540, mfj: 11_080, hoh: 11_080 };
const AMT_EXEMPTION_2025: Record<FilingStatus, number> = { single: 89_393, mfs: 59_594, mfj: 119_190, hoh: 89_393 };
const AMT_PHASEOUT_2025: Record<FilingStatus, number> = { single: 335_224, mfs: 223_482, mfj: 446_966, hoh: 335_224 };
const MENTAL_HEALTH_THRESHOLD = 1_000_000;

function bracketsFor(fs: FilingStatus, f: number): Bracket[] {
  const base = fs === "hoh" ? HOH_2025 : SINGLE_2025;
  const mult = fs === "mfj" ? 2 : 1;
  return base.map((b) => ({ upTo: Number.isFinite(b.upTo) ? Math.round(b.upTo * mult * f) : Infinity, rate: b.rate }));
}

export const california: StateModule = {
  code: "CA",
  name: "California",
  compute(inputs: YearInputs, ledger: Ledger, ctx): void {
    const fs = inputs.filingStatus;
    const f = (1 + ctx.inflation) ** Math.max(0, inputs.year - 2025);
    const agi = ctx.agi;
    const itemized = inputs.propertyTax + inputs.mortgageInterestPaid + inputs.charitableCash + inputs.charitableStock;
    const standard = Math.round(STANDARD_2025[fs] * f);
    const deduction = Math.max(itemized, standard);
    const taxable = Math.max(0, agi - deduction);
    const brackets = bracketsFor(fs, f);
    const regular = bracketTax(taxable, brackets);
    const mental = Math.max(0, taxable - MENTAL_HEALTH_THRESHOLD) * 0.01;
    ledger.put("stateTaxableIncome", "California taxable income", taxable, `Federal AGI (${usd(agi)}) less the larger of California's standard deduction (${usd(standard)}) and itemized deductions without state tax (${usd(itemized)}). Capital gains are ordinary income in California.`, ["agi"]);
    ledger.put("stateRegularTax", "California income tax", regular + mental, `California brackets from 1% to 12.3% on ${usd(taxable)}` + (mental > 0 ? `, plus the 1% mental health surtax on the ${usd(taxable - MENTAL_HEALTH_THRESHOLD)} over $1,000,000` : "") + ".", ["stateTaxableIncome"]);

    // California AMT: 7% on AMTI above an exemption; the ISO spread counts, and the higher AMT basis on ISO shares sold comes back off.
    // California's minimum-tax credit for later years is not modeled, so AMT paid here never returns; that overstates a multi-year exercise-and-sell plan.
    const amti = Math.max(0, taxable + inputs.isoBargainElement + inputs.amtCapitalAdjustment + (itemized > standard ? 0 : standard));
    const exemption = Math.max(0, AMT_EXEMPTION_2025[fs] * f - 0.25 * Math.max(0, amti - AMT_PHASEOUT_2025[fs] * f));
    const tmt = Math.max(0, amti - exemption) * 0.07;
    const amt = Math.max(0, tmt - regular);
    ledger.put("stateAmt", "California AMT", amt, amt > 0 ? `7% of AMTI (${usd(amti)}, including the ISO spread) above the ${usd(exemption)} exemption exceeds regular California tax by ${usd(amt)}.` : `California's 7% AMT (${usd(tmt)} tentative) is below regular tax; nothing extra.`, ["stateRegularTax", "isoBargainElement"]);
    const total = regular + mental + amt;
    ledger.put("stateIncomeTax", "California income tax paid", total, "Regular tax + surtax + AMT. This amount is used as your state income tax for the federal SALT deduction.", ["stateRegularTax", "stateAmt"]);
    ledger.put("stateTax", "California tax", total, `Effective ${pct(agi > 0 ? total / agi : 0)} of AGI. Approximate model: no California credits (including the minimum-tax credit), exemptions indexed by your inflation assumption.`, ["stateIncomeTax"]);
  },
};
