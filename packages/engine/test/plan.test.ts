import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile } from "../src/profile.ts";
import { runPlan, resolveLevers } from "../src/plan.ts";
import { exerciseSpread, sharesExercisable, rsuVesting, vestingOf } from "../src/equity.ts";
import { amtCrossover, sweepIsoExercise } from "../src/thresholds.ts";

const profile = parseProfile(readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8"));

describe("multi-year plan", () => {
  test("credit generated in an exercise year is recovered in later years", () => {
    const plan = runPlan(profile, { exercises: { iso: { 2026: 20_000 }, nso: {} } });
    const [y0, y1] = plan.years;
    expect(y0!.lines.amt!.value).toBeGreaterThan(0);
    expect(y1!.lines.amtCreditCarryforwardIn!.value).toBeCloseTo(y0!.lines.amtCreditCarryforwardOut!.value);
    expect(y1!.lines.amtCreditUsed!.value).toBeGreaterThan(0);
    const carries = plan.years.map((y) => y.lines.amtCreditCarryforwardOut!.value);
    for (let i = 1; i < carries.length; i++) expect(carries[i]!).toBeLessThanOrEqual(carries[i - 1]! + 1e-6);
  });
  test("exercising nothing means no AMT anywhere", () => {
    const plan = runPlan(profile, { exercises: { iso: { 2026: 0 }, nso: {} } });
    expect(plan.totals.amt).toBe(0);
  });
  test("shares are drawn from grants in order and cannot exceed what is left", () => {
    const levers = resolveLevers(profile, { exercises: { iso: { 2026: 30_000, 2027: 30_000 }, nso: {} } });
    expect(sharesExercisable(profile, levers, "iso", 2027)).toBe(10_000);
    expect(exerciseSpread(profile, levers, "iso", 2026, 1_000)).toBeCloseTo(1_000 * 16);
    expect(exerciseSpread(profile, levers, "iso", 2027, 1_000)).toBeCloseTo(1_000 * (18 * 1.15 - 2));
    const plan = runPlan(profile, { exercises: { iso: { 2026: 30_000, 2027: 30_000 }, nso: {} } });
    expect(plan.years[1]!.inputs.isoSharesExercised).toBe(10_000);
  });
  test("RSU schedule vests through the plan and creates wage income", () => {
    const rsu = profile.equity.grants.find((g) => g.type === "rsu")!;
    const v = vestingOf(profile, rsu);
    // 8,000 units, 4 years quarterly from 2025-03-15 with a 1-year cliff: 2025 vests nothing before 2026.
    const total = v.vestedAtStart + Object.values(v.byYear).reduce((a, b) => a + b, 0);
    expect(total).toBe(8_000);
    expect(v.vestedAtStart).toBe(0);
    expect(v.byYear[2026]).toBe(2_000 + 500 + 500 + 500); // cliff lump in March plus three quarters
    expect(v.byYear[2029]).toBe(500);
    const y26 = rsuVesting(profile, 2026);
    expect(y26.income).toBeCloseTo(3_500 * 18);
    const plan = runPlan(profile);
    expect(plan.years[0]!.lines.rsuIncome!.value).toBeCloseTo(3_500 * 18);
    expect(plan.years[0]!.lines.agi!.value).toBeCloseTo(330_000 + 3_500 * 18);
  });
  test("NSO exercises are ordinary income, not an AMT preference", () => {
    const withNso = { ...profile, equity: { ...profile.equity, grants: [...profile.equity.grants, { name: "NSO", type: "nso" as const, shares: 5_000, strike: 1, vested: 5_000 }] } };
    const plan = runPlan(withNso, { exercises: { iso: { 2026: 0 }, nso: { 2026: 5_000 } } });
    const y = plan.years[0]!;
    expect(y.lines.nsoIncome!.value).toBeCloseTo(5_000 * 17);
    expect(y.lines.isoBargainElement!.value).toBe(0);
    expect(y.lines.amt!.value).toBe(0);
  });
  test("wages grow each year", () => {
    const plan = runPlan(profile);
    expect(plan.years[1]!.inputs.wages).toBeCloseTo(profile.income.wages * 1.03);
  });
});

describe("thresholds", () => {
  test("crossover finds the last AMT-free share count", () => {
    const c = amtCrossover(profile, { exercises: { iso: { 2026: 0 }, nso: {} } }, 2026);
    expect(c.sharesBeforeAmt).toBeGreaterThan(0);
    expect(c.sharesBeforeAmt).toBeLessThan(c.available);
    const at = (n: number) => runPlan(profile, { exercises: { iso: { 2026: n }, nso: {} } }).years[0]!.lines.amt!.value;
    expect(at(c.sharesBeforeAmt)).toBe(0);
    expect(at(c.sharesBeforeAmt + 1)).toBeGreaterThan(0);
  });
  test("sweep is monotone in AMT", () => {
    const pts = sweepIsoExercise(profile, undefined, 2026, 20);
    expect(pts).toHaveLength(21);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.amt).toBeGreaterThanOrEqual(pts[i - 1]!.amt);
  });
});
