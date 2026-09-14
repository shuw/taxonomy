import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile } from "../src/profile.ts";
import { runPlan, isoBargainElement, isoSharesAvailable, resolveLevers } from "../src/plan.ts";
import { amtCrossover, sweepIsoExercise } from "../src/thresholds.ts";

const profile = parseProfile(readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8"));

describe("multi-year plan", () => {
  test("credit generated in an exercise year is recovered in later years", () => {
    const plan = runPlan(profile, { isoExercises: { 2026: 20_000 } });
    const [y0, y1] = plan.years;
    expect(y0!.lines.amt!.value).toBeGreaterThan(0);
    expect(y1!.lines.amtCreditCarryforwardIn!.value).toBeCloseTo(y0!.lines.amtCreditCarryforwardOut!.value);
    expect(y1!.lines.amtCreditUsed!.value).toBeGreaterThan(0);
    const carries = plan.years.map((y) => y.lines.amtCreditCarryforwardOut!.value);
    for (let i = 1; i < carries.length; i++) expect(carries[i]!).toBeLessThanOrEqual(carries[i - 1]! + 1e-6);
  });
  test("exercising nothing means no AMT anywhere", () => {
    const plan = runPlan(profile, { isoExercises: { 2026: 0 } });
    expect(plan.totals.amt).toBe(0);
  });
  test("shares are drawn from grants in order and cannot exceed what is left", () => {
    const levers = resolveLevers(profile, { isoExercises: { 2026: 30_000, 2027: 30_000 } });
    expect(isoSharesAvailable(profile, levers, 2027)).toBe(10_000);
    expect(isoBargainElement(profile, levers, 2026, 1_000)).toBeCloseTo(1_000 * 16);
    expect(isoBargainElement(profile, levers, 2027, 1_000)).toBeCloseTo(1_000 * (18 * 1.15 - 2));
    const plan = runPlan(profile, { isoExercises: { 2026: 30_000, 2027: 30_000 } });
    expect(plan.years[1]!.inputs.isoSharesExercised).toBe(10_000);
  });
  test("wages grow each year", () => {
    const plan = runPlan(profile);
    expect(plan.years[1]!.inputs.wages).toBeCloseTo(profile.income.wages * 1.03);
  });
});

describe("thresholds", () => {
  test("crossover finds the last AMT-free share count", () => {
    const c = amtCrossover(profile, { isoExercises: { 2026: 0 } }, 2026);
    expect(c.sharesBeforeAmt).toBeGreaterThan(0);
    expect(c.sharesBeforeAmt).toBeLessThan(c.available);
    const at = (n: number) => runPlan(profile, { isoExercises: { 2026: n } }).years[0]!.lines.amt!.value;
    expect(at(c.sharesBeforeAmt)).toBe(0);
    expect(at(c.sharesBeforeAmt + 1)).toBeGreaterThan(0);
  });
  test("sweep is monotone in AMT", () => {
    const pts = sweepIsoExercise(profile, undefined, 2026, 20);
    expect(pts).toHaveLength(21);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.amt).toBeGreaterThanOrEqual(pts[i - 1]!.amt);
  });
});
