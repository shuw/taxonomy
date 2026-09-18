import { describe, expect, test } from "bun:test";
import { vestingOf } from "../src/equity.ts";
import { readFileSync } from "node:fs";
import { parseProfile } from "../src/profile.ts";
import { runPlan } from "../src/plan.ts";
import { applySale, isLongTerm, lotMilestones, lotsFromRsu, lowestTaxOrder, longTermFrom, type Lot } from "../src/lots.ts";
import { amtCrossover, creditRecovery, holdOrSell, sharesToCover } from "../src/thresholds.ts";
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
    expect(y.sales![0]!.lots.map((l) => l.lotId)).toEqual(["rsu-2026-1", "rsu-2026-2", "rsu-2026-3", "rsu-2026-4", "x-g1-2026"]);
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

describe("liquidity events", () => {
  test("a liquidity event settles double-trigger RSUs that year and pins the share price", () => {
    const rsu = { ...profile.equity.grants.find((g) => g.type === "rsu")!, settlement: "liquidity" as const };
    const p: Profile = { ...profile, equity: { ...profile.equity, grants: profile.equity.grants.map((g) => (g.id === rsu.id ? rsu : g)) } };
    const none = runPlan({ ...p, scenarios: { default: { events: [] } }, activeScenario: "default" });
    expect(none.years.every((y) => y.inputs.rsuSharesVested === 0)).toBe(true);
    const ipo = runPlan({ ...p, scenarios: { default: { events: [{ id: "e1", kind: "liquidity", year: 2028, price: 60 }] } }, activeScenario: "default" });
    const y28 = ipo.years.find((y) => y.year === 2028)!;
    expect(y28.inputs.rsuSharesVested).toBeGreaterThan(0);
    expect(y28.inputs.rsuIncome / y28.inputs.rsuSharesVested).toBeCloseTo(60, 6);
    expect(ipo.years.find((y) => y.year === 2027)!.inputs.rsuSharesVested).toBe(0);
  });
});

describe("two companies", () => {
  const two: Profile = {
    ...profile,
    equity: {
      ...profile.equity,
      companies: [...profile.equity.companies, { id: "c2", name: "Beta", sharePrice: 5 }],
      grants: [...profile.equity.grants, { id: "gb", name: "Beta ISO", type: "iso", company: "c2", granted: 10_000, vestedToDate: 10_000, exercisedToDate: 0, strike: 1 }],
    },
  };
  test("an exercise event scoped to a company draws only from that company's grants", () => {
    const p = { ...two, scenarios: { default: { events: [{ id: "e1", kind: "exercise" as const, type: "iso" as const, year: 2026, company: "c2", shares: 4_000 }] } }, activeScenario: "default" };
    const y = runPlan(p).years[0]!;
    expect(y.inputs.isoSharesExercised).toBe(4_000);
    expect(y.inputs.isoBargainElement).toBeCloseTo(4_000 * (5 - 1));
    expect(y.lotsEnd!.find((l) => l.id === "x-gb-2026")?.quantity).toBe(4_000);
    expect(y.lotsEnd!.find((l) => l.id === "x-g1-2026")).toBeUndefined();
  });
  test("an unscoped event means the first company, and each company has its own AMT-free count", () => {
    const p = { ...two, scenarios: { default: { events: [{ id: "e1", kind: "exercise" as const, type: "iso" as const, year: 2026, shares: 1_000 }] } }, activeScenario: "default" };
    expect(runPlan(p).years[0]!.inputs.isoBargainElement).toBeCloseTo(1_000 * 16);
    const a = amtCrossover(p, undefined, 2026, "c1");
    const b = amtCrossover(p, undefined, 2026, "c2");
    expect(a.available).toBe(40_000);
    expect(b.available).toBe(10_000);
    expect(b.sharesBeforeAmt).toBeGreaterThan(a.sharesBeforeAmt);
  });
});

describe("cash", () => {
  test("exercise cost and sale proceeds show up as cash lines", () => {
    const p = withEvents([{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 1_000 }, { id: "e2", kind: "sell", year: 2027, shares: 1_000 }]);
    const y26 = year(p, 2026);
    expect(y26.lines.exerciseCost!.value).toBe(1_000 * 2);
    expect(y26.lines.netCash!.value).toBeCloseTo(y26.lines.cashIn!.value - y26.lines.exerciseCost!.value - y26.lines.totalTax!.value);
    const y27 = year(p, 2027);
    expect(y27.lines.cashIn!.value).toBeGreaterThan(y27.inputs.salarySelf);
  });
});

describe("credit recovery", () => {
  test("credit from an exercise comes back in later years, and the path sums", () => {
    const p = withEvents([{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 20_000 }]);
    const r = creditRecovery(p, undefined, 2026)!;
    expect(r.generated).toBeGreaterThan(0);
    expect(r.path.map((x) => x.year)).toEqual([2027, 2028, 2029, 2030]);
    const back = r.path.reduce((s, x) => s + x.recovered, 0);
    expect(back + r.leftover).toBeCloseTo(r.generated, 0);
    expect(r.path[0]!.recovered).toBeGreaterThan(0);
    expect(creditRecovery(withEvents([]), undefined, 2026)).toBeNull();
  });
});

describe("hold or sell", () => {
  test("holding defers to long-term gain; selling the same day is ordinary income with no AMT", () => {
    const p = withEvents([{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 20_000 }]);
    const h = holdOrSell(p, undefined, 2026)!;
    expect(h.hold.why).toMatch(/AMT on the spread now/); expect(h.sell.why).toMatch(/disqualifying/); expect(h.fields.cashNeeded).toMatch(/negative/);
    expect(h.shares).toBe(20_000);
    expect(h.hold.saleYear).toBe(2027);
    expect(h.holdPrice).toBeGreaterThan(h.sellPrice);
    expect(h.sell.taxInYear).toBeGreaterThan(0);
    expect(h.hold.cashNeeded).toBeGreaterThan(h.sell.cashNeeded);
    expect(h.hold.proceeds).toBeCloseTo(20_000 * h.holdPrice, 0);
    expect(h.sell.proceeds).toBeCloseTo(20_000 * h.sellPrice, 0);
    expect(holdOrSell(withEvents([]), undefined, 2026)).toBeNull();
  });
});

describe("dated vests and the $100k split", () => {
  test("RSU units vesting on a date become a lot acquired that day, so the holding period is right", () => {
    const p = parseProfile(readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8"));
    const rsu = p.equity.grants.find((g) => g.type === "rsu")!;
    rsu.vesting = { "2026-08-20": 1000, "2026-11-20": 500 };
    rsu.schedule = undefined;
    const lots = lotsFromRsu(p, 2026);
    expect(lots.map((l) => [l.acquired, l.quantity])).toEqual([["2026-08-20", 1000], ["2026-11-20", 500]]);
    expect(isLongTerm(lots[0]!, "2027-08-20")).toBe(false);
    expect(isLongTerm(lots[0]!, "2027-08-21")).toBe(true);
  });
  test("an ISO tranche and its NSO split share one schedule, ISO first up to $100k of strike a year", () => {
    const p = parseProfile(readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8"));
    const iso = p.equity.grants.find((g) => g.type === "iso")!;
    // 60,000 options at $2 vesting 20,000 a year (the ISO tranche carries the combined vests): $100k of strike covers 50,000 ISOs a year, so the NSO side gets nothing here...
    iso.granted = 30_000; iso.vestedToDate = 0; iso.exercisedToDate = 0; iso.vesting = { "2026": 20_000, "2027": 20_000, "2028": 20_000 }; iso.schedule = undefined;
    p.equity.grants.push({ id: "g9", name: "NSO tranche", type: "nso", granted: 30_000, vestedToDate: 0, exercisedToDate: 0, strike: iso.strike, splitOf: iso.id });
    expect(vestingOf(p, iso).byYear).toEqual({ 2026: 20_000, 2027: 20_000, 2028: 20_000 });
    expect(vestingOf(p, p.equity.grants.find((g) => g.id === "g9")!).byYear).toEqual({ 2026: 0, 2027: 0, 2028: 0 });
    // ...but at a $40 strike only 2,500 a year can be ISOs; the rest of each year's 20,000 vests as NSOs.
    iso.strike = 40; p.equity.grants.find((g) => g.id === "g9")!.strike = 40;
    expect(vestingOf(p, iso).byYear).toEqual({ 2026: 2_500, 2027: 2_500, 2028: 2_500 });
    expect(vestingOf(p, p.equity.grants.find((g) => g.id === "g9")!).byYear).toEqual({ 2026: 17_500, 2027: 17_500, 2028: 17_500 });
  });
});
