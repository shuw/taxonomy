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
 * A proposed high-earner income tax can be switched on with a chosen rate and threshold.
 */
const DEDUCTION_2025 = 278_000;
const SURTAX_THRESHOLD = 1_000_000;

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
    const he = policy.waHighEarnerTax;
    const heBase = he?.enabled ? Math.max(0, ctx.agi - he.threshold) : 0;
    const heTax = he?.enabled ? heBase * he.rate : 0;
    ledger.put(
      "stateHighEarnerTax", "Washington high-earner tax (proposed)", heTax,
      he?.enabled
        ? `A proposal, not law: ${pct(he.rate)} of AGI over ${usd(he.threshold)} (${usd(heBase)} over). Switch it off in assumptions to see current law.`
        : "Off. A proposed Washington income tax on high earners can be switched on in assumptions, with the rate and threshold of the bill you are tracking.",
      ["agi"],
    );
    ledger.put("stateTax", "Washington tax", base + surtax + heTax, "Capital gains excise tax" + (he?.enabled ? " + the proposed high-earner tax" : "") + ".", ["stateCapitalGainsTax", "stateHighEarnerTax"]);
  },
};
