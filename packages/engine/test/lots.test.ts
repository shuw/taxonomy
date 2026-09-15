import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile } from "../src/profile.ts";
import { runPlan } from "../src/plan.ts";
import { applySale, lotMilestones, lowestTaxOrder, longTermFrom, type Lot } from "../src/lots.ts";
import { sharesToCover } from "../src/thresholds.ts";
import type { Profile, ScenarioEvent } from "../src/types.ts";

const profile = parseProfile(readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8"));
const withEvents = (events: ScenarioEvent[]): Profile => ({ ...profile, scenarios: { default: { events } }, activeScenario: "default" });
const year = (p: Profile, y: number) => runPlan(p).years.find((r) => r.year === y)!;

const iso = (over: Partial<Lot> = {}): Lot => ({ id: "a", label: "ISO lot", quantity: 1000, acquired: "2026-01-01", via: "iso_exercise", costBasis: 2, amtBasis: 18, grantDate: "2023-06-01", ...over });
const nso = (over: Partial<Lot> = {}): Lot => ({ id: "b", label: "NSO lot", quantity: 1000, acquired: "2026-01-01", via: "nso_exercise", costBasis: 18, amtBasis: 18, ...over });

describe("holding periods", () => {
  test("long-term starts the day after a full year", () => {
    expect(longTermFrom("2026-01-01")).toBe("2027-01-02");
    expect(longTermFrom("2024-02-29")).toBe("2025-03-02");
  });
  test("milestones list when lots turn long-term and qualifying", () => {
    const lots = [iso({ grantDate: "2026-06-01" }), nso({ acquired: "2025-03-01" })];
    const m = lotMilestones(lots, "2026-12-31");
    expect(m.map((x) => [x.lotId, x.becomes, x.date])).toEqual([["a", "long-term", "2027-01-02"], ["a", "qualifying", "2028-06-02"]]);
  });
});

describe("selling lots", () => {
  test("lowest tax first: qualifying and long-term lots before short-term, highest basis first", () => {
    const lots = [iso({ id: "st", acquired: "2027-06-01" }), nso({ id: "lt-low", costBasis: 5 }), nso({ id: "lt-high", costBasis: 30 }), iso({ id: "dq", acquired: "2026-01-01", grantDate: "2027-01-01" })];
    expect(lowestTaxOrder(lots, "2027-12-31").map((l) => l.id)).toEqual(["lt-high", "lt-low", "st", "dq"]);
  });
  test("a qualifying ISO sale is long-term gain over the strike with a negative AMT adjustment", () => {
    const { remaining, result } = applySale(profile, [iso()], { id: "s", shares: 400, price: 25 }, 2027);
    expect(result.longTermGain).toBe(400 * (25 - 2));
    expect(result.shortTermGain).toBe(0);
    expect(result.ordinaryIncome).toBe(0);
    expect(result.amtAdjustment).toBe(-400 * (18 - 2));
    expect(result.lots[0]!.qualifying).toBe(true);
    expect(remaining[0]!.quantity).toBe(600);
  });
  test("a same-year ISO sale is disqualifying: the spread is ordinary income and the rest short-term", () => {
    const { result } = applySale(profile, [iso()], { id: "s", shares: 100, price: 25 }, 2026);
    expect(result.ordinaryIncome).toBe(100 * (18 - 2));
    expect(result.shortTermGain).toBe(100 * (25 - 18));
    expect(result.longTermGain).toBe(0);
    expect(result.lots[0]!.qualifying).toBe(false);
  });
  test("a disqualifying sale below the exercise value limits the ordinary income to the actual gain", () => {
    const { result } = applySale(profile, [iso()], { id: "s", shares: 100, price: 10 }, 2026);
    expect(result.ordinaryIncome).toBe(100 * (10 - 2));
    expect(result.shortTermGain).toBe(0);
  });
  test("specific lots can be named", () => {
    const { result } = applySale(profile, [iso(), nso()], { id: "s", shares: 0, lots: { b: 250 } }, 2027);
    expect(result.picked).toBe("as specified");
    expect(result.lots.map((l) => [l.lotId, l.shares])).toEqual([["b", 250]]);
  });
});

describe("sales in the plan", () => {
  test("shares exercised this year can be sold next year long-term, and the AMT basis adjustment frees credit", () => {
    const p = withEvents([{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 20_000 }, { id: "e2", kind: "sell", year: 2027, shares: 20_000 }]);
    const y26 = year(p, 2026);
    const y27 = year(p, 2027);
    expect(y26.lines.amt!.value).toBeGreaterThan(0);
    expect(y27.inputs.sharesSold).toBe(20_000);
    expect(y27.lines.longTermGains!.value).toBeGreaterThan(0);
    expect(y27.lines.isoDisqualifyingIncome!.value).toBe(0);
    expect(y27.lines.amtCapitalAdjustment!.value).toBeLessThan(0);
    const noSale = year(withEvents([{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 20_000 }]), 2027);
    expect(y27.lines.amtCreditUsed!.value).toBeGreaterThanOrEqual(noSale.lines.amtCreditUsed!.value);
    expect(y27.lotsEnd!.reduce((s, l) => s + l.quantity, 0)).toBe(noSale.lotsEnd!.reduce((s, l) => s + l.quantity, 0) - 20_000);
  });
  test("selling in the exercise year removes the AMT preference and creates ordinary income", () => {
    // The RSU lot settling this year has no gain, so the rule sells it first; selling everything reaches the ISO shares too.
    const p = withEvents([{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 20_000 }, { id: "e2", kind: "sell", year: 2026, shares: 23_500 }]);
    const y = year(p, 2026);
    expect(y.sales![0]!.lots.map((l) => l.lotId)).toEqual(["rsu-2026", "x-g1-2026"]);
    expect(y.lines.isoDisqualifyingIncome!.value).toBe(20_000 * 16);
    expect(y.lines.amti!.value).toBeCloseTo(y.lines.taxableIncome!.value + y.lines.amtAddbacks!.value, 0);
    expect(y.lines.amtCreditGenerated!.value).toBe(0);
  });
  test("a sale cannot exceed what is held", () => {
    const y = year(withEvents([{ id: "e2", kind: "sell", year: 2026, shares: 999_999 }]), 2026);
    expect(y.inputs.sharesSold).toBe(y.lotsBefore!.reduce((s, l) => s + l.quantity, 0));
    expect(y.lotsEnd).toEqual([]);
  });
  test("sell to cover finds the smallest sale whose proceeds pay the year's tax", () => {
    const p = withEvents([{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 20_000 }, { id: "e2", kind: "sell", year: 2027, shares: 0 }]);
    const n = sharesToCover(p, undefined, 2027, "e2");
    expect(n).toBeGreaterThan(0);
    const y = year(withEvents([{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 20_000 }, { id: "e2", kind: "sell", year: 2027, shares: n }]), 2027);
    expect(y.inputs.saleProceeds).toBeGreaterThanOrEqual(y.lines.totalTax!.value);
    const less = year(withEvents([{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 20_000 }, { id: "e2", kind: "sell", year: 2027, shares: n - 1 }]), 2027);
    expect(less.inputs.saleProceeds).toBeLessThan(less.lines.totalTax!.value);
  });
});
