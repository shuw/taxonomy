import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { editProfileText, isLegacyProfileText, migrateProfileText, parseProfile, stringifyProfile } from "../src/profile.ts";
import { runPlan } from "../src/plan.ts";
import { activeLevers } from "../src/timeline.ts";
import { exercisedTotal } from "../src/events.ts";

const example = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");

describe("profile editing", () => {
  test("edits values and keeps comments", () => {
    const out = editProfileText(example, [
      { path: ["people", "self", "salary"], value: 410_000 },
      { path: ["filer", "filingStatus"], value: "mfj" },
      { path: ["scenarios", "default", "events", 0, "shares"], value: 1_500 },
    ]);
    const p = parseProfile(out);
    expect(p.people.self.salary).toBe(410_000);
    expect(p.filer.filingStatus).toBe("mfj");
    expect(exercisedTotal(activeLevers(p), "iso", 2026)).toBe(1_500);
    expect(out).toContain("# Taxonomy profile");
    expect(out).toContain("# already exercised");
  });
  test("undefined deletes a key and lists can be replaced", () => {
    const out = editProfileText(example, [
      { path: ["deductions", "charitable", "cash"], value: undefined },
      { path: ["equity", "grants"], value: [{ id: "a", name: "A", type: "iso", strike: 1, granted: 100 }, { id: "b", name: "B", type: "rsu", granted: 200 }] },
    ]);
    const p = parseProfile(out);
    expect(p.deductions?.charitable?.cash).toBeUndefined();
    expect(p.equity.grants.map((g) => g.name)).toEqual(["A", "B"]);
  });
  test("numeric and quoted year keys resolve to the same entry", () => {
    const quoted = editProfileText(example, [{ path: ["equity", "grants", 0, "vesting"], value: { 2026: 4000 } }, { path: ["equity", "grants", 0, "schedule"], value: undefined }]);
    expect(quoted).toContain('"2026": 4000');
    const plain = quoted.replace('"2026": 4000', "2026: 4000");
    for (const text of [quoted, plain]) {
      const out = editProfileText(text, [{ path: ["equity", "grants", 0, "vesting", 2026], value: 9_000 }]);
      expect(out.match(/2026/g)!.length).toBe(text.match(/2026/g)!.length);
      expect(parseProfile(out).equity.grants[0]!.vesting?.[2026]).toBe(9_000);
    }
    const created = editProfileText(plain, [{ path: ["equity", "grants", 0, "vesting", 2027], value: 5 }]);
    expect(created).toContain("2027: 5");
    expect(created).not.toContain('"2027"');
  });
  test("a scenario stored as a lever table becomes exercise events", () => {
    const old = example.replace(/scenarios:[\s\S]*?activeScenario/, "scenarios:\n  default:\n    exercises:\n      iso:\n        2026: 4000\n      nso: { 2027: 10 }\nactiveScenario");
    const p = parseProfile(old);
    expect(p.scenarios?.default?.events).toEqual([{ id: "e1", kind: "exercise", type: "iso", year: 2026, shares: 4000 }, { id: "e2", kind: "exercise", type: "nso", year: 2027, shares: 10 }]);
    expect(exercisedTotal(activeLevers(p), "nso", 2027)).toBe(10);
  });
  test("version 1 files parse into the current shape and migrate to a fresh document", () => {
    const legacy = `version: 1
filer: { filingStatus: single, state: WA }
plan: { startYear: 2026, years: 3 }
assumptions: { inflation: 0.02, wageGrowth: 0, fmvGrowth: 0.1 }
income: { wages: 100000, interest: 500 }
deductions: { propertyTax: 9000, charitable: 1200, mortgageInterest: 15000 }
equity:
  isoGrants:
    - name: old
      strike: 2
      fmv: 20
      shares: 1000
  amtCreditCarryforward: 4000
levers:
  isoExercises:
    2026: 100
`;
    expect(isLegacyProfileText(legacy)).toBe(true);
    const p = parseProfile(legacy);
    expect(p.version).toBe(3);
    expect(p.people.self.salary).toBe(100_000);
    expect(p.equity.companies[0]).toMatchObject({ id: "c1", sharePrice: 20 });
    expect(p.equity.grants[0]).toMatchObject({ id: "g1", type: "iso", granted: 1000, vestedToDate: 1000, strike: 2 });
    expect(p.carryforwards?.amtCredit).toBe(4000);
    expect(p.home?.propertyTax).toBe(9000);
    expect(p.home?.mortgageInterest).toBe(15000);
    expect(p.deductions?.charitable).toEqual({ cash: 1200 });
    expect(exercisedTotal(activeLevers(p), "iso", 2026)).toBe(100);
    expect(p.activeScenario).toBe("default");
    const migrated = migrateProfileText(legacy);
    expect(isLegacyProfileText(migrated)).toBe(false);
    expect(migrated).toContain("version: 3");
    expect(parseProfile(migrated)).toEqual(p);
    expect(migrateProfileText(migrated)).toBe(migrated);
  });
  test("version 2 grants become the granted/vested/exercised triple with ids, and sources move to ids", () => {
    const v2 = `version: 2
filer: { filingStatus: mfj, state: WA, dependents: 2 }
plan: { startYear: 2026, years: 3 }
assumptions: { inflation: 0.02, wageGrowth: 0, fmvGrowth: 0.1 }
people: { self: { salary: 100000 } }
income: {}
equity:
  company: Acme
  sharePrice: 21
  grants:
    - { name: iso, type: iso, granted: 60000, shares: 47500, vested: 40000, strike: 2 }
    - { name: rsu, type: rsu, shares: 8000, vested: 3500 }
  holdings:
    - { lot: L1, quantity: 100, acquired: 2025-01-01, via: iso_exercise, costBasis: 2 }
priorReturn: { year: 2025, inputs: { wages: 1 }, reported: { agi: 1 } }
levers: { exercises: { iso: { 2026: 5 }, nso: {} } }
sources: { "equity.grants.1": "Shareworks", "equity.sharePrice": "409A", "people.self.salary": "stub" }
`;
    const p = parseProfile(v2);
    expect(p.filer.dependents).toHaveLength(2);
    expect(p.equity.companies[0]).toMatchObject({ id: "c1", name: "Acme", sharePrice: 21 });
    expect(p.equity.grants[0]).toMatchObject({ id: "g1", granted: 60_000, exercisedToDate: 12_500, vestedToDate: 52_500 });
    expect(p.equity.grants[1]).toMatchObject({ id: "g2", granted: 8_000, vestedToDate: 3_500 });
    expect(p.equity.holdings?.[0]?.id).toBe("h1");
    expect(p.returns?.[0]?.year).toBe(2025);
    expect(p.sources).toEqual({ "grants.g2": "Shareworks", "companies.c1.sharePrice": "409A", "people.self.salary": "stub" });
    expect(runPlan(p).years[0]!.inputs.isoSharesExercised).toBe(5);
  });
  test("stringifyProfile round-trips the example, and a profile missing the basics is rejected", () => {
    const p = parseProfile(example);
    expect(parseProfile(stringifyProfile(p))).toEqual(p);
    expect(() => parseProfile("version: 1\nfiler: { filingStatus: single }\n")).toThrow(/state/);
  });
});

describe("review fixes", () => {
  test("dependents typed as birth years, a list of years, or a count all become entries", () => {
    const withDeps = (v: string) => parseProfile(example.replace("dependents: []", `dependents: ${v}`)).filer.dependents;
    expect(withDeps('"2019, 2022"')).toEqual([{ birthYear: 2019 }, { birthYear: 2022 }]);
    expect(withDeps("[2019, 2022]")).toEqual([{ birthYear: 2019 }, { birthYear: 2022 }]);
    expect(withDeps("2")).toEqual([{}, {}]);
  });
  test("legacy sources keyed by grant index land on the right grant when isoGrants came first", () => {
    const v2 = `version: 2
filer: { filingStatus: single, state: WA }
plan: { startYear: 2026, years: 2 }
assumptions: { inflation: 0.02, wageGrowth: 0, fmvGrowth: 0 }
people: { self: { salary: 100000 } }
income: {}
equity:
  sharePrice: 10
  isoGrants:
    - { name: old, shares: 100, strike: 1 }
  grants:
    - { name: rsu, type: rsu, granted: 50, vestedToDate: 0 }
sources: { "equity.grants.0": "Shareworks RSU page" }
`;
    const p = parseProfile(v2);
    expect(p.equity.grants.map((g) => g.name)).toEqual(["old", "rsu"]);
    expect(p.sources).toEqual({ "grants.g2": "Shareworks RSU page" });
  });
});

describe("ids", () => {
  test("dated changes get stable ids on read and keep the ones they have", () => {
    const p = parseProfile(example.replace("timeline: []", "timeline:\n  - { year: 2027, path: people.self.salary, value: 1 }\n  - { id: t9, year: 2028, path: people.self.salary, value: 2 }\n  - { year: 2029, path: people.self.salary, value: 3 }"));
    expect(p.timeline!.map((t) => t.id)).toEqual(["t10", "t9", "t11"]);
  });
  test("a new id is one past the highest in use, so a removed item's id is not reused", () => {
    const { newId } = require("../src/equity.ts") as typeof import("../src/equity.ts");
    expect(newId("g", ["g1", "g3"])).toBe("g4");
    expect(newId("g", [])).toBe("g1");
  });
  test("a grant that names a company that does not exist is a problem, not a silent fallback", () => {
    expect(() => parseProfile(example.replace("company: c1", "company: c9"))).toThrow(/company "c9"/);
  });
});
