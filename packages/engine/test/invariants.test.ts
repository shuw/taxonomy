import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile } from "../src/profile.ts";
import { runPlan } from "../src/plan.ts";
import type { ScenarioEvent } from "../src/types.ts";

/** Things that must hold for any plan, checked over many generated scenarios on the demo profile. */
const base = parseProfile(readFileSync(new URL("../../../data/demo.yaml", import.meta.url), "utf8"));
const years = [2026, 2027, 2028, 2029, 2030];

// A small deterministic generator, so a failure is reproducible by seed.
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0; return s / 2 ** 32; }; }
function scenario(seed: number): ScenarioEvent[] {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const events: ScenarioEvent[] = [];
  let n = 0;
  const add = (e: Record<string, unknown>) => events.push({ id: `e${++n}`, ...e } as unknown as ScenarioEvent);
  for (const y of years) {
    if (r() < 0.6) add({ kind: "exercise", type: "iso", year: y, date: `${y}-${pick(["02", "06", "11"])}-15`, shares: Math.round(r() * 30_000) });
    if (r() < 0.4) add({ kind: "exercise", type: "nso", year: y, shares: Math.round(r() * 15_000) });
    if (r() < 0.5) add({ kind: "sell", year: y, shares: Math.round(r() * 40_000) });
    if (r() < 0.3) add({ kind: "give", year: y, how: pick(["cash", "stock", "daf"]), amount: Math.round(r() * 60_000) });
  }
  if (r() < 0.5) add({ kind: "liquidity", year: pick(years), price: 10 + Math.round(r() * 60) });
  return events;
}

describe("plan invariants", () => {
  for (let seed = 1; seed <= 40; seed++) {
    test(`hold for generated scenario ${seed}`, () => {
      const events = scenario(seed);
      const profile = { ...base, scenarios: { ...base.scenarios, gen: { events } }, activeScenario: "gen" };
      const plan = runPlan(profile);
      const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
      let creditCarry = 0;
      for (const y of plan.years) {
        const L = (id: string) => { const l = y.lines[id]; if (!l) throw new Error(`${y.year}: no line ${id}`); return l.value; };
        // Sums add up.
        expect(near(L("totalTax"), L("federalTotal") + L("stateTax")), `${y.year} total`).toBe(true);
        expect(near(L("federalTotal"), L("federalIncomeTax") + L("niit") + L("additionalMedicare")), `${y.year} federal`).toBe(true);
        expect(near(L("federalIncomeTax"), L("regularTax") + L("amt") - L("amtCreditUsed")), `${y.year} income tax`).toBe(true);
        expect(near(L("netCash"), L("cashIn") - L("cashOut")), `${y.year} net cash`).toBe(true);
        // Nothing goes negative that cannot.
        for (const id of ["amt", "amtCreditUsed", "regularTax", "taxableIncome", "exerciseCost", "isoSharesExercised", "nsoIncome", "sharesSold", "giving", "givingStock", "stateTax", "niit", "additionalMedicare"]) expect(L(id), `${y.year} ${id} >= 0`).toBeGreaterThanOrEqual(-0.005);
        expect(y.inputs.nsoSharesExercised).toBeGreaterThanOrEqual(0);
        expect(L("taxableIncome")).toBeLessThanOrEqual(L("agi") + 0.005);
        expect(L("amt")).toBeLessThanOrEqual(Math.max(0, L("tentativeMinimumTax") - L("regularTax")) + 0.005);
        // The AMT credit is a bank: what is used never exceeds what was carried in, and the balance rolls forward exactly.
        expect(near(L("amtCreditCarryforwardIn"), creditCarry), `${y.year} credit carry-in`).toBe(true);
        expect(L("amtCreditUsed")).toBeLessThanOrEqual(L("amtCreditCarryforwardIn") + 0.005);
        expect(near(L("amtCreditCarryforwardOut"), L("amtCreditCarryforwardIn") + L("amtCreditGenerated") - L("amtCreditUsed")), `${y.year} credit roll`).toBe(true);
        creditCarry = L("amtCreditCarryforwardOut");
        // Shares: what is sold was held, and exercises never exceed the grants.
        const heldBefore = (y.lotsBefore ?? []).reduce((s, l) => s + l.quantity, 0);
        expect(L("sharesSold")).toBeLessThanOrEqual(heldBefore + 0.5);
        const heldEnd = (y.lotsEnd ?? []).reduce((s, l) => s + l.quantity, 0);
        expect(heldEnd).toBeGreaterThanOrEqual(-0.5);
      }
      const totalIso = plan.years.reduce((s, y) => s + y.lines.isoSharesExercised!.value, 0);
      const isoOutstanding = base.equity.grants.filter((g) => g.type === "iso").reduce((s, g) => s + g.granted - (g.exercisedToDate ?? 0), 0);
      expect(totalIso).toBeLessThanOrEqual(isoOutstanding + 0.5);
      expect(near(plan.totals.totalTax, plan.years.reduce((s, y) => s + y.lines.totalTax!.value, 0), 2)).toBe(true);
    });
  }
});
