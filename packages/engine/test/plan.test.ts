import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile } from "../src/profile.ts";
import { runPlan, resolveLevers } from "../src/plan.ts";
import { exerciseSpread, sharesExercisable, rsuVesting, vestingOf } from "../src/equity.ts";
import { amtCrossover, sweepIsoExercise } from "../src/thresholds.ts";
import { calibrate } from "../src/calibration.ts";
import { companyPrice, sharesOutstanding } from "../src/equity.ts";
import { profileInYear } from "../src/timeline.ts";

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
    expect(plan.years[0]!.lines.agi!.value).toBeCloseTo(320_000 - 23_500 + 6_000 + 4_500 + 3_500 * 18);
  });
  test("NSO exercises are ordinary income, not an AMT preference", () => {
    const withNso = { ...profile, equity: { ...profile.equity, grants: [...profile.equity.grants, { id: "g9", name: "NSO", type: "nso" as const, granted: 5_000, vestedToDate: 5_000, strike: 1 }] } };
    const plan = runPlan(withNso, { exercises: { iso: { 2026: 0 }, nso: { 2026: 5_000 } } });
    const y = plan.years[0]!;
    expect(y.lines.nsoIncome!.value).toBeCloseTo(5_000 * 17);
    expect(y.lines.isoBargainElement!.value).toBe(0);
    expect(y.lines.amt!.value).toBe(0);
  });
  test("wages grow each year", () => {
    const plan = runPlan(profile);
    expect(plan.years[1]!.inputs.salarySelf).toBeCloseTo(profile.people.self.salary * 1.03);
  });
});

describe("mortgage, carryforwards and calibration", () => {
  test("a mortgage over the cap produces partly deductible interest that declines each year", () => {
    const withMortgage = { ...profile, home: { mortgage: { balance: 900_000, rate: 0.06, originated: "2024-01-01", originalAmount: 950_000 } } };
    const plan = runPlan(withMortgage);
    const y0 = plan.years[0]!, y1 = plan.years[1]!;
    expect(y0.inputs.mortgageInterestPaid).toBeGreaterThan(50_000);
    expect(y0.inputs.mortgageCapFraction).toBeLessThan(1);
    expect(y1.inputs.mortgageInterestPaid).toBeLessThan(y0.inputs.mortgageInterestPaid);
    expect(y0.lines.usesItemized!.value).toBe(1);
  });
  test("capital loss and charitable balances thread through the years", () => {
    const p = { ...profile, carryforwards: { capitalLoss: { shortTerm: 0, longTerm: 7_000 } }, deductions: { charitable: { cash: 500_000 } } };
    const plan = runPlan(p);
    expect(plan.years[0]!.inputs.capitalLossCarryIn.longTerm).toBe(7_000);
    expect(plan.years[1]!.inputs.capitalLossCarryIn.longTerm).toBe(4_000);
    expect(plan.years[1]!.inputs.charitableCarryIn).toBeGreaterThan(0);
  });
  test("calibration recomputes the prior return line by line", () => {
    const p = { ...profile, returns: [{ year: 2025, inputs: { wages: 300_000, interest: 5_000, qualifiedDividends: 4_000, ordinaryDividends: 4_000 }, reported: { agi: 309_000, taxableIncome: 293_250, totalTax: 72_000 } }] };
    const cal = calibrate(p)!;
    expect(cal.year).toBe(2025);
    const agi = cal.rows.find((r) => r.id === "agi")!;
    expect(agi.computed).toBe(309_000);
    expect(agi.delta).toBe(0);
    const ti = cal.rows.find((r) => r.id === "taxableIncome")!;
    expect(ti.computed).toBe(309_000 - 15_750);
    expect(cal.missing).toContain("amt");
  });
});

describe("timeline, scenarios and companies", () => {
  test("a timeline entry changes the facts from its year on", () => {
    const p = { ...profile, timeline: [{ year: 2028, path: "people.self.salary", value: 500_000 }, { year: 2027, path: "filer.filingStatus", value: "mfj" }] };
    expect(profileInYear(p, 2026).people.self.salary).toBe(320_000);
    expect(profileInYear(p, 2028).people.self.salary).toBe(500_000);
    expect(profileInYear(p, 2027).filer.filingStatus).toBe("mfj");
    const plan = runPlan(p);
    expect(plan.years[0]!.inputs.filingStatus).toBe("single");
    expect(plan.years[1]!.inputs.filingStatus).toBe("mfj");
    expect(plan.years[2]!.inputs.salarySelf).toBeCloseTo(500_000 * 1.03 ** 2);
  });
  test("the active scenario supplies the levers", () => {
    const p = { ...profile, scenarios: { default: { exercises: { iso: { 2026: 4_000 }, nso: {} } }, big: { exercises: { iso: { 2026: 30_000 }, nso: {} } } }, activeScenario: "big" };
    expect(runPlan(p).years[0]!.inputs.isoSharesExercised).toBe(30_000);
    expect(runPlan({ ...p, activeScenario: "default" }).years[0]!.inputs.isoSharesExercised).toBe(4_000);
  });
  test("a price path pins a year and growth resumes from it", () => {
    const c = { ...profile.equity.companies[0]!, pricePath: { 2027: 40 } };
    const p = { ...profile, equity: { ...profile.equity, companies: [c] } };
    expect(companyPrice(p, c, 2026)).toBeCloseTo(18);
    expect(companyPrice(p, c, 2027)).toBe(40);
    expect(companyPrice(p, c, 2028)).toBeCloseTo(46);
  });
  test("outstanding shares exclude exercised ones", () => {
    expect(sharesOutstanding({ id: "x", name: "x", type: "iso", granted: 60_000, exercisedToDate: 12_500, vestedToDate: 52_500, strike: 2 })).toBe(47_500);
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
