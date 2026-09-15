import type { Ledger } from "../ledger.ts";
import type { StatePolicy, YearInputs } from "../types.ts";
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

const modules: Record<string, StateModule> = { WA: washington };

export function stateModule(code: string): StateModule {
  return modules[code.toUpperCase()] ?? none;
}
