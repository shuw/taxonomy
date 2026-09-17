import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile, editProfileText, isLegacyProfileText, migrateProfileText } from "../src/profile.ts";
import { profileInYear } from "../src/timeline.ts";
import { describeChanges } from "../src/history.ts";
import { runPlan } from "../src/plan.ts";
import * as tools from "../src/tools.ts";

const example = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");

describe("a dated change with an end year", () => {
  test("applies only inside its years; without one it carries on", () => {
    const p = parseProfile(editProfileText(example, [{ path: ["timeline"], value: [
      { id: "t1", year: 2027, until: 2027, path: "income.interest", value: 50_000 },
      { id: "t2", year: 2028, path: "people.self.salary", value: 400_000 },
    ] }]));
    const interest = (y: number) => profileInYear(p, y).income.interest ?? 0;
    expect([2026, 2027, 2028].map(interest)).toEqual([p.income.interest ?? 0, 50_000, p.income.interest ?? 0]);
    expect([2027, 2028, 2029].map((y) => profileInYear(p, y).people.self.salary)).toEqual([p.people.self.salary, 400_000, 400_000]);
  });

  test("history says so", () => {
    const before = parseProfile(example);
    const after = parseProfile(editProfileText(example, [{ path: ["timeline"], value: [{ id: "t1", year: 2027, until: 2027, path: "income.interest", value: 50_000 }] }]));
    expect(describeChanges(before, after).join(" ")).toContain("in 2027 only");
  });
});

describe("a gift as a decision", () => {
  test("adds to the year's giving on top of the recurring figure, cash to cash out, shares beside it", () => {
    const base = parseProfile(editProfileText(example, [{ path: ["deductions", "charitable", "cash"], value: 5_000 }, { path: ["scenarios", "default", "events"], value: [] }]));
    const p = parseProfile(editProfileText(example, [{ path: ["deductions", "charitable", "cash"], value: 5_000 }, { path: ["scenarios", "default", "events"], value: [
      { id: "e1", kind: "give", year: 2027, how: "cash", amount: 40_000 },
      { id: "e2", kind: "give", year: 2027, how: "stock", amount: 100_000 },
    ] }]));
    const y0 = runPlan(base).years[1]!, y = runPlan(p).years[1]!;
    expect(y.lines.giving?.value).toBe(45_000);
    expect(y.lines.givingStock?.value).toBe(100_000);
    expect(y.lines.cashOut!.value - y0.lines.cashOut!.value).toBeCloseTo(40_000 - (y0.lines.totalTax!.value - y.lines.totalTax!.value), 0);
    expect(y.lines.totalTax!.value).toBeLessThan(y0.lines.totalTax!.value);
    expect(runPlan(p).years[2]!.lines.giving?.value).toBe(5_000);
  });

  test("history and the tool layer describe it, and refuse an empty one", () => {
    const before = parseProfile(editProfileText(example, [{ path: ["scenarios", "default", "events"], value: [] }]));
    const after = parseProfile(editProfileText(example, [{ path: ["scenarios", "default", "events"], value: [{ id: "e1", kind: "give", year: 2027, how: "daf", amount: 25_000 }] }]));
    expect(describeChanges(before, after).join(" ")).toContain("give $25,000 to a donor-advised fund in 2027");
    expect(() => tools.whatIf(before, [{ kind: "give", year: 2027, how: "cash", amount: 0 }])).toThrow("more than 0");
    expect(tools.whatIf(before, [{ kind: "give", year: 2027, how: "cash", amount: 80_000 }]).delta.byYear.find((d) => d.year === 2027)!.totalTax).toBeLessThan(0);
  });
});

describe("gifts written as one-year facts", () => {
  test("are read as gift decisions in every scenario", () => {
    const p = parseProfile(editProfileText(example, [
      { path: ["timeline"], value: [{ id: "t1", year: 2027, until: 2027, path: "deductions.charitable.appreciatedStock", value: 300_000 }, { id: "t2", year: 2028, path: "people.self.salary", value: 400_000 }] },
      { path: ["scenarios", "other"], value: { events: [] } },
    ]));
    expect(p.timeline?.map((t) => t.id)).toEqual(["t2"]);
    for (const s of Object.values(p.scenarios!)) expect(s.events.some((e) => e.kind === "give" && e.how === "stock" && e.amount === 300_000 && e.year === 2027)).toBe(true);
  });
});

describe("the gift-fact rewrite", () => {
  test("happens once: the rewritten text has no entry left, and re-reading adds nothing", () => {
    const text = editProfileText(example, [{ path: ["timeline"], value: [{ id: "t1", year: 2027, until: 2027, path: "deductions.charitable.cash", value: 40_000 }] }, { path: ["scenarios", "default", "events"], value: [] }]);
    expect(isLegacyProfileText(text)).toBe(true);
    const rewritten = migrateProfileText(text);
    expect(rewritten).not.toBe(text);
    expect(isLegacyProfileText(rewritten)).toBe(false);
    const gives = (t: string) => parseProfile(t).scenarios!.default!.events.filter((e) => e.kind === "give").length;
    expect(gives(rewritten)).toBe(1);
    expect(gives(migrateProfileText(rewritten))).toBe(1);
    // Even an unrewritten text read twice, with its converted gift saved back, stays at one.
    const savedBack = editProfileText(text, [{ path: ["scenarios", "default", "events"], value: parseProfile(text).scenarios!.default!.events }]);
    expect(gives(savedBack)).toBe(1);
  });
});

describe("gift facts on top of recurring giving", () => {
  test("the converted decision is the amount beyond the recurring figure, and the facts tool refuses the shape", () => {
    const p = parseProfile(editProfileText(example, [
      { path: ["deductions", "charitable", "cash"], value: 10_000 },
      { path: ["scenarios", "default", "events"], value: [] },
      { path: ["timeline"], value: [{ id: "t1", year: 2027, until: 2027, path: "deductions.charitable.cash", value: 40_000 }] },
    ]));
    const give = p.scenarios!.default!.events.find((e) => e.kind === "give");
    expect(give && give.kind === "give" ? give.amount : null).toBe(30_000);
    expect(runPlan(p).years[1]!.lines.giving?.value).toBe(40_000);
    expect(() => tools.updateFacts(p, [{ field: "deductions.charitable.cash", value: 50_000, from: 2028, until: 2028 }])).toThrow("give event");
  });
});

describe("edge cases the reviewers asked for", () => {
  test("an end year before the start year is a parse problem", () => {
    expect(() => parseProfile(editProfileText(example, [{ path: ["timeline"], value: [{ id: "t1", year: 2028, until: 2027, path: "income.interest", value: 1 }] }]))).toThrow("before it starts");
  });
  test("a gift outside the plan years is refused", () => {
    expect(() => tools.whatIf(parseProfile(example), [{ kind: "give", year: 2040, how: "cash", amount: 1_000 }])).toThrow("not in the plan");
  });
});
