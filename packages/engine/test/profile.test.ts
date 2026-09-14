import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { editProfileText, isLegacyProfileText, migrateProfileText, parseProfile, stringifyProfile } from "../src/profile.ts";

const example = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");

describe("profile editing", () => {
  test("edits values and keeps comments", () => {
    const out = editProfileText(example, [
      { path: ["people", "self", "salary"], value: 410_000 },
      { path: ["filer", "filingStatus"], value: "mfj" },
      { path: ["levers", "exercises", "iso", 2027], value: 1_500 },
    ]);
    const p = parseProfile(out);
    expect(p.people.self.salary).toBe(410_000);
    expect(p.filer.filingStatus).toBe("mfj");
    expect(p.levers?.exercises?.iso[2027]).toBe(1_500);
    expect(out).toContain("# Taxonomy profile");
    expect(out).toContain("# unexercised");
  });
  test("undefined deletes a key and lists can be replaced", () => {
    const out = editProfileText(example, [
      { path: ["deductions", "charitable", "cash"], value: undefined },
      { path: ["equity", "grants"], value: [{ name: "A", type: "iso", strike: 1, shares: 100 }, { name: "B", type: "rsu", shares: 200 }] },
    ]);
    const p = parseProfile(out);
    expect(p.deductions?.charitable?.cash).toBeUndefined();
    expect(p.equity.grants.map((g) => g.name)).toEqual(["A", "B"]);
  });
  test("numeric and quoted year keys resolve to the same entry", () => {
    const quoted = example.replace("      2026: 4000", '      "2026": 4000');
    expect(quoted).not.toBe(example);
    const out = editProfileText(quoted, [{ path: ["levers", "exercises", "iso", 2026], value: 9_000 }]);
    expect(out.match(/2026/g)!.length).toBe(example.match(/2026/g)!.length);
    expect(parseProfile(out).levers?.exercises?.iso[2026]).toBe(9_000);
    const created = editProfileText(example, [{ path: ["levers", "exercises", "nso"], value: {} }, { path: ["levers", "exercises", "nso", 2027], value: 5 }]);
    expect(created).toContain("2027: 5");
    expect(created).not.toContain('"2027"');
  });
  test("version 1 files parse into the v2 shape and migrate to a fresh v2 document", () => {
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
    expect(p.version).toBe(2);
    expect(p.people.self.salary).toBe(100_000);
    expect(p.equity.sharePrice).toBe(20);
    expect(p.equity.grants[0]).toMatchObject({ type: "iso", shares: 1000, strike: 2, vested: 1000 });
    expect(p.carryforwards?.amtCredit).toBe(4000);
    expect(p.home?.propertyTax).toBe(9000);
    expect(p.deductions?.charitable).toEqual({ cash: 1200 });
    expect(p.deductions?.mortgageInterest).toBe(15000);
    expect(p.levers?.exercises?.iso[2026]).toBe(100);
    const migrated = migrateProfileText(legacy);
    expect(isLegacyProfileText(migrated)).toBe(false);
    expect(migrated).toContain("version: 2");
    expect(migrated).toContain("sharePrice: 20");
    expect(parseProfile(migrated)).toEqual(p);
    expect(migrateProfileText(migrated)).toBe(migrated);
  });
  test("stringifyProfile round-trips the example", () => {
    const p = parseProfile(example);
    expect(parseProfile(stringifyProfile(p))).toEqual(p);
  });
  test("rejects a profile missing the basics", () => {
    expect(() => parseProfile("version: 1\nfiler: { filingStatus: single }\n")).toThrow(/state/);
  });
});
