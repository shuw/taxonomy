import type { Ledger } from "../ledger.ts";
import { usd } from "../ledger.ts";
import type { YearInputs } from "../types.ts";
import type { StateModule } from "./index.ts";

/**
 * Washington has no income tax. It does levy a capital gains excise tax on long-term gains
 * above a standard deduction: 7% (RCW 82.87) plus, from 2025, an additional 2.9% on gains
 * over $1M (SB 5813). The deduction is indexed; 2025 is the last published value.
 * ISO exercises are not Washington gains; real estate and retirement-account gains are exempt
 * but not distinguished here (all longTermGains are treated as taxable).
 */
const DEDUCTION_2025 = 278_000;
const SURTAX_THRESHOLD = 1_000_000;

export const washington: StateModule = {
  code: "WA",
  name: "Washington",
  compute(inputs: YearInputs, ledger: Ledger, inflation: number): void {
    const years = Math.max(0, inputs.year - 2025);
    const deduction = Math.round((DEDUCTION_2025 * (1 + inflation) ** years) / 1000) * 1000;
    const gains = Math.max(0, inputs.longTermGains);
    const taxable = Math.max(0, gains - deduction);
    const base = taxable * 0.07;
    const surtax = Math.max(0, taxable - SURTAX_THRESHOLD) * 0.029;
    ledger.put(
      "stateTax",
      "Washington capital gains tax",
      base + surtax,
      taxable === 0
        ? `Washington has no income tax. Its capital gains excise tax applies only to long-term gains above ${usd(deduction)}; you have ${usd(gains)}.`
        : `7% of long-term gains above the ${usd(deduction)} deduction (${usd(taxable)} taxable)` +
          (surtax > 0 ? `, plus 2.9% on the ${usd(taxable - SURTAX_THRESHOLD)} over $1,000,000` : "") +
          `. Wages and ISO exercises are not Washington gains.`,
      ["longTermGains"],
    );
  },
};
