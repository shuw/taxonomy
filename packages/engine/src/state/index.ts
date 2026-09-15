import type { Ledger } from "../ledger.ts";
import type { StatePolicy, YearInputs } from "../types.ts";
import { california } from "./ca.ts";
import { washington } from "./wa.ts";

export interface StateContext {
  inflation: number;
  policy: StatePolicy;
  /** Federal AGI for the year, from the federal ledger. */
  agi: number;
}

export interface StateModule {
  code: string;
  name: string;
  /** Must put a "stateTax" line on the ledger. */
  compute(inputs: YearInputs, ledger: Ledger, ctx: StateContext): void;
}

const none: StateModule = {
  code: "none",
  name: "No state tax modeled",
  compute(inputs, ledger) {
    ledger.put("stateTax", "State tax", 0, `No model for state "${inputs.state}" yet; state tax is shown as zero.`, []);
  },
};

const noIncomeTax = (code: string, name: string): StateModule => ({
  code,
  name,
  compute(_inputs, ledger) {
    ledger.put("stateTax", `${name} tax`, 0, `${name} has no personal income tax and no capital gains tax.`, []);
  },
});

const modules: Record<string, StateModule> = {
  WA: washington,
  CA: california,
  TX: noIncomeTax("TX", "Texas"),
  FL: noIncomeTax("FL", "Florida"),
  NV: noIncomeTax("NV", "Nevada"),
};

/** States with a model, for the picker. */
export const MODELED_STATES: { code: string; name: string; note: string }[] = [
  { code: "WA", name: "Washington", note: "capital gains excise tax" },
  { code: "CA", name: "California", note: "income tax with AMT" },
  { code: "TX", name: "Texas", note: "no income tax" },
  { code: "FL", name: "Florida", note: "no income tax" },
  { code: "NV", name: "Nevada", note: "no income tax" },
];

export function stateModule(code: string): StateModule {
  return modules[code.toUpperCase()] ?? none;
}
