import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile } from "../src/profile.ts";
import { runPlan } from "../src/plan.ts";
import { activeLevers } from "../src/timeline.ts";

describe("the demo profile", () => {
  const profile = parseProfile(readFileSync(new URL("../../../data/demo.yaml", import.meta.url), "utf8"));
  test("shows every kind of equity, a raise, gifts and an AMT year", () => {
    const plan = runPlan(profile, activeLevers(profile));
    const by = Object.fromEntries(plan.years.map((y) => [y.year, y.lines]));
    expect(by[2026]!.amt!.value).toBeGreaterThan(0);
    expect(by[2027]!.amt!.value).toBe(0);
    expect(by[2027]!.nsoIncome!.value).toBeGreaterThan(0);
    expect(by[2028]!.rsuIncome!.value).toBeGreaterThan(0);
    expect(by[2027]!.wages!.value).toBeGreaterThan(by[2026]!.wages!.value * 1.1);
    expect(by[2026]!.giving!.value).toBeGreaterThan(profile.deductions.charitable.cash);
    expect(by[2028]!.givingStock!.value).toBeGreaterThan(0);
    expect(plan.years[plan.years.length - 1]!.lines.amtCreditCarryforwardOut!.value).toBe(0);
  });
});
