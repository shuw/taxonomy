import type { Ledger } from "../ledger.ts";
import { pct, usd } from "../ledger.ts";
import type { YearInputs } from "../types.ts";
import type { StateModule } from "./index.ts";

/**
 * Washington has no income tax. It does levy a capital gains excise tax on long-term gains
 * above a standard deduction: 7% (RCW 82.87) plus, from 2025, an additional 2.9% on gains
 * over $1M (SB 5813). The deduction is indexed; 2025 is the last published value.
 * ISO exercises are not Washington gains; real estate and retirement-account gains are exempt
 * but not distinguished here (all longTermGains are treated as taxable).
 * From tax year 2028 the millionaires' tax (SB 6346, signed March 2026) adds 9.9% on Washington
 * taxable income over a $1M household deduction, indexed every two years. The base is federal
 * AGI less long-term gains, which stay under the excise tax; wages, RSU vests and NSO spread are
 * in, ISO spread is not (it is outside AGI). Modeled at the statute's numbers; the law faces a
 * court challenge and a repeal initiative, so it can be switched off.
 */
const DEDUCTION_2025 = 278_000;
const SURTAX_THRESHOLD = 1_000_000;
const MILLIONAIRES_FROM = 2028;
const MILLIONAIRES_RATE = 0.099;
const MILLIONAIRES_DEDUCTION = 1_000_000;

export const washington: StateModule = {
  code: "WA",
  name: "Washington",
  compute(inputs: YearInputs, ledger: Ledger, ctx): void {
    const policy = ctx.policy;
    const years = Math.max(0, inputs.year - 2025);
    const deduction = Math.round((DEDUCTION_2025 * (1 + ctx.inflation) ** years) / 1000) * 1000;
    const gains = Math.max(0, inputs.longTermGains);
    const taxable = Math.max(0, gains - deduction);
    const capGainsOn = policy.waCapitalGainsTax !== false;
    const surtaxOn = policy.waCapitalGainsSurtax !== false;
    const base = capGainsOn ? taxable * 0.07 : 0;
    const surtax = capGainsOn && surtaxOn ? Math.max(0, taxable - SURTAX_THRESHOLD) * 0.029 : 0;
    ledger.put(
      "stateCapitalGainsTax", "Washington capital gains tax", base + surtax,
      !capGainsOn
        ? "Switched off in assumptions: Washington's capital gains excise tax is not applied."
        : taxable === 0
          ? `Washington has no income tax. Its capital gains excise tax applies only to long-term gains above ${usd(deduction)}; you have ${usd(gains)}.`
          : `7% of long-term gains above the ${usd(deduction)} deduction (${usd(taxable)} taxable)` +
            (surtax > 0 ? `, plus 2.9% on the ${usd(taxable - SURTAX_THRESHOLD)} over $1,000,000 (2025 surtax)` : surtaxOn ? "" : "; the 2.9% surtax is switched off") +
            `. Wages and ISO exercises are not Washington gains.`,
      ["longTermGains"],
    );
    const mOn = policy.waMillionairesTax !== false;
    const mLive = mOn && inputs.year >= MILLIONAIRES_FROM;
    const mSteps = 2 * Math.floor(Math.max(0, inputs.year - MILLIONAIRES_FROM) / 2);
    const mDeduction = Math.round((MILLIONAIRES_DEDUCTION * (1 + ctx.inflation) ** mSteps) / 1000) * 1000;
    const mIncome = Math.max(0, ctx.agi - gains);
    const mBase = mLive ? Math.max(0, mIncome - mDeduction) : 0;
    const mTax = mBase * MILLIONAIRES_RATE;
    ledger.put(
      "stateMillionairesTax", "Washington millionaires' tax", mTax,
      !mOn
        ? "Switched off in assumptions: the 9.9% tax on income over $1M (SB 6346, from 2028) is not applied."
        : !mLive
          ? `Starts with tax year ${MILLIONAIRES_FROM}: ${pct(MILLIONAIRES_RATE)} on income over a ${usd(MILLIONAIRES_DEDUCTION)} household deduction (SB 6346, signed March 2026).`
          : mBase === 0
            ? `${pct(MILLIONAIRES_RATE)} on income over the ${usd(mDeduction)} household deduction; your ${usd(mIncome)} (AGI less long-term gains, which the excise tax covers) is under it.`
            : `${pct(MILLIONAIRES_RATE)} of the ${usd(mBase)} of income over the ${usd(mDeduction)} household deduction. Income is AGI (${usd(ctx.agi)}) less long-term gains (${usd(gains)}), which the excise tax covers. Wages, RSU vests and NSO spread count; ISO spread does not.`,
      ["agi", "longTermGains"],
    );
    ledger.put("stateTax", "Washington tax", base + surtax + mTax, "Capital gains excise tax" + (mLive ? " + the millionaires' tax" : "") + ".", ["stateCapitalGainsTax", "stateMillionairesTax"]);
  },
};
