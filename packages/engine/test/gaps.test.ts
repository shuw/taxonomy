import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile, editProfileText } from "../src/profile.ts";
import { profileGaps } from "../src/gaps.ts";
import { reviewIntake, changesToEdits } from "../src/intake/apply.ts";
import { parseIntake } from "../src/intake/schema.ts";
import { runPlan } from "../src/plan.ts";
import * as tools from "../src/tools.ts";
import type { Holding } from "../src/types.ts";

const example = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");
const lot: Holding = { id: "h9", lot: "may-2026", quantity: 2_500, acquired: "2026-05-05", via: "iso_exercise", costBasis: 2, amtBasis: 20, grantDate: "2023-01-15" };

describe("an option lot exercised inside the plan", () => {
  test("is a gap with a one-click fill that models the exercise, prices the year and drops the lot", () => {
    const p = parseProfile(editProfileText(example, [{ path: ["equity", "holdings"], value: [lot] }, { path: ["scenarios", "default", "events"], value: [] }]));
    const gap = profileGaps(p).find((g) => g.id === "holdings.h9.exercise");
    expect(gap).toBeDefined();
    expect(gap!.text).toContain("2026 is missing its AMT");
    const after = parseProfile(editProfileText(example, [{ path: ["equity", "holdings"], value: [lot] }, { path: ["scenarios", "default", "events"], value: [] }, ...gap!.fill!.edits]));
    expect(after.equity.holdings).toEqual([]);
    expect(after.scenarios!.default!.events).toEqual([{ id: "e1", kind: "exercise", type: "iso", year: 2026, date: "2026-05-05", shares: 2_500 }]);
    expect(after.equity.companies[0]!.pricePath?.[2026]).toBe(20);
    const y = runPlan(after).years[0]!;
    expect(y.lines.isoSharesExercised?.value).toBe(2_500);
    expect(y.lines.isoBargainElement?.value).toBe(45_000);
    expect(profileGaps(after).some((g) => g.id.startsWith("holdings."))).toBe(false);
  });

  test("moves the shares back to exercisable when the grant's counts were read after the exercise", () => {
    const p = parseProfile(editProfileText(example, [{ path: ["equity", "holdings"], value: [lot] }, { path: ["equity", "grants", 0, "exercisedToDate"], value: 2_500 }, { path: ["equity", "grants", 0, "countsAsOf"], value: "2026-06-01" }]));
    const gap = profileGaps(p).find((g) => g.id === "holdings.h9.exercise")!;
    expect(gap.fill!.edits).toContainEqual({ path: ["equity", "grants", 0, "exercisedToDate"], value: 0 });
  });

  test("intake turns it into a decision instead of an opening lot", () => {
    const profile = parseProfile(editProfileText(example, [{ path: ["scenarios", "default", "events"], value: [] }]));
    const doc = parseIntake(`taxonomy_intake: 1\nequity:\n  holdings:\n    - { lot: may-2026, quantity: 2500, acquired: 2026-05-05, via: iso_exercise, costBasis: 2, amtBasis: 20 }\n    - { lot: old, quantity: 1000, acquired: 2024-03-01, via: iso_exercise, costBasis: 2, amtBasis: 9 }\nsources:\n  equity.holdings: "portal holdings page"\n`);
    expect(doc.problems).toEqual([]);
    const review = reviewIntake(doc.doc!, profile);
    const events = review.changes.find((c) => c.format === "events");
    expect(events?.label).toBe("Exercises inside the plan (1)");
    expect((events!.proposed as unknown[]).length).toBe(1);
    const holdings = review.changes.find((c) => c.format === "holdings");
    expect((holdings!.proposed as Holding[]).map((h) => h.lot)).toEqual(["old"]);
    expect(review.changes.some((c) => c.path.join(".") === "equity.companies.0.pricePath.2026" && c.proposed === 20)).toBe(true);
    const after = parseProfile(editProfileText(example, [{ path: ["scenarios", "default", "events"], value: [] }, ...changesToEdits(review.changes, profile)]));
    expect(after.scenarios!.default!.events.map((e) => e.kind)).toEqual(["exercise"]);
    expect(runPlan(after).years[0]!.lines.isoSharesExercised?.value).toBe(2_500);
  });
});

describe("gaps and the plan for an agent", () => {
  test("a grant with unvested shares and no schedule is a gap, and outstanding carries the list", () => {
    const p = parseProfile(editProfileText(example, [{ path: ["equity", "grants", 1, "schedule"], value: undefined }]));
    expect(profileGaps(p).some((g) => g.id === "grants.g2.schedule")).toBe(true);
    expect(tools.outstanding(p).gaps.some((g) => g.id === "grants.g2.schedule" && g.oneClickInApp === false)).toBe(true);
  });

  test("get_plan rounds money to whole dollars, keeps rates, and carries the AMT reasons", () => {
    const p = parseProfile(editProfileText(example, [{ path: ["scenarios", "default", "events"], value: [{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 30_000 }] }]));
    const y = tools.plan(p).years[0]!;
    expect(y.lines.amt).toBeGreaterThan(0);
    for (const [id, v] of Object.entries(y.lines)) if (!id.startsWith("effectiveRate")) expect(Number.isInteger(v)).toBe(true);
    expect(y.lines.effectiveRateWithSpread).toBeGreaterThan(0);
    expect(y.lines.effectiveRateWithSpread!).toBeLessThan(y.lines.effectiveRate!);
    expect(y.why?.amt ?? "").toContain("minimum tax");
  });

  test("zero-share events are refused", () => {
    const p = parseProfile(example);
    expect(() => tools.whatIf(p, [{ kind: "exercise", type: "nso", year: 2027, shares: 0 }])).toThrow("more than 0");
  });
});

describe("which grant an in-plan lot came from", () => {
  const lot: Holding = { id: "h1", lot: "l", quantity: 1_000, acquired: "2026-04-01", via: "iso_exercise", costBasis: 2, amtBasis: 20, grantDate: "2024-01-15" };
  test("the grant date breaks a tie between two grants of the same type", () => {
    const p = parseProfile(editProfileText(example, [{ path: ["equity", "grants"], value: [
      { id: "g1", name: "2023 ISO", type: "iso", company: "c1", granted: 10_000, vestedToDate: 10_000, exercisedToDate: 5_000, strike: 2, grantDate: "2023-01-15", countsAsOf: "2026-06-01" },
      { id: "g3", name: "2024 ISO", type: "iso", company: "c1", granted: 10_000, vestedToDate: 10_000, exercisedToDate: 1_000, strike: 4, grantDate: "2024-01-15", countsAsOf: "2026-06-01" },
    ] }, { path: ["equity", "holdings"], value: [lot] }]));
    const gap = profileGaps(p).find((g) => g.id === "holdings.h1.exercise")!;
    expect(gap.fill!.edits).toContainEqual({ path: ["equity", "grants", 1, "exercisedToDate"], value: 0 });
  });
  test("without a grant date the first grant that fits is used, and counts read before the exercise are left alone", () => {
    const p = parseProfile(editProfileText(example, [{ path: ["equity", "grants"], value: [
      { id: "g1", name: "A", type: "iso", company: "c1", granted: 10_000, vestedToDate: 10_000, exercisedToDate: 5_000, strike: 2, countsAsOf: "2026-01-01" },
      { id: "g3", name: "B", type: "iso", company: "c1", granted: 10_000, vestedToDate: 10_000, exercisedToDate: 5_000, strike: 4, countsAsOf: "2026-06-01" },
    ] }, { path: ["equity", "holdings"], value: [{ ...lot, grantDate: undefined }] }]));
    const gap = profileGaps(p).find((g) => g.id === "holdings.h1.exercise")!;
    expect(gap.fill!.edits).toContainEqual({ path: ["equity", "grants", 1, "exercisedToDate"], value: 4_000 });
  });
});

describe("an exercise lot without its value at exercise", () => {
  test("is flagged rather than silently valued at the modeled price", () => {
    const base = parseProfile(readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8"));
    const lot: Holding = { id: "h7", lot: "March exercise", quantity: 1000, acquired: `${base.plan.startYear}-03-01`, via: "iso_exercise", costBasis: 2, grantDate: "2023-02-01" };
    const p = parseProfile(editProfileText(readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8"), [{ path: ["equity", "holdings"], value: [lot] }]));
    const gaps = profileGaps(p);
    expect(gaps.some((g) => g.id === "holdings.h7.amtBasis" && /value at exercise/.test(g.text))).toBe(true);
    expect(profileGaps(parseProfile(editProfileText(readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8"), [{ path: ["equity", "holdings"], value: [{ ...lot, amtBasis: 15 }] }]))).some((g) => g.id === "holdings.h7.amtBasis")).toBe(false);
  });
});
