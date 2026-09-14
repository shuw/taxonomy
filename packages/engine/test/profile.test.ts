import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { editProfileText, parseProfile } from "../src/profile.ts";

const example = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");

describe("profile editing", () => {
  test("edits values and keeps comments", () => {
    const out = editProfileText(example, [
      { path: ["income", "wages"], value: 410_000 },
      { path: ["filer", "filingStatus"], value: "mfj" },
      { path: ["levers", "isoExercises", 2027], value: 1_500 },
    ]);
    const p = parseProfile(out);
    expect(p.income.wages).toBe(410_000);
    expect(p.filer.filingStatus).toBe("mfj");
    expect(p.levers?.isoExercises?.[2027]).toBe(1_500);
    expect(out).toContain("# Taxonomy profile");
    expect(out).toContain("# WA has none");
  });
  test("undefined deletes a key and lists can be replaced", () => {
    const out = editProfileText(example, [
      { path: ["deductions", "charitable"], value: undefined },
      { path: ["equity", "isoGrants"], value: [{ name: "A", strike: 1, fmv: 5, shares: 100 }, { name: "B", strike: 2, fmv: 5, shares: 200 }] },
    ]);
    const p = parseProfile(out);
    expect(p.deductions.charitable).toBeUndefined();
    expect(p.equity.isoGrants.map((g) => g.name)).toEqual(["A", "B"]);
  });
  test("numeric and quoted year keys resolve to the same entry", () => {
    const quoted = example.replace("    2026: 4000", '    "2026": 4000');
    const out = editProfileText(quoted, [{ path: ["levers", "isoExercises", 2026], value: 9_000 }]);
    expect(out.match(/2026/g)!.length).toBe(example.match(/2026/g)!.length);
    expect(parseProfile(out).levers?.isoExercises?.[2026]).toBe(9_000);
    const created = editProfileText(example, [{ path: ["levers", "isoExercises"], value: {} }, { path: ["levers", "isoExercises", 2027], value: 5 }]);
    expect(created).toContain("2027: 5");
    expect(created).not.toContain('"2027"');
  });
  test("rejects a profile missing the basics", () => {
    expect(() => parseProfile("version: 1\nfiler: { filingStatus: single }\n")).toThrow(/state/);
  });
});
