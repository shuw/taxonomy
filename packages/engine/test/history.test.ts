import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { describeChanges } from "../src/history.ts";
import { editProfileText, parseProfile } from "../src/profile.ts";
import * as tools from "../src/tools.ts";

const text = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");
const profile = parseProfile(text);
const after = (edits: Parameters<typeof editProfileText>[1]) => parseProfile(editProfileText(text, edits));

describe("profile history", () => {
  test("nothing changed, nothing said", () => {
    expect(describeChanges(profile, profile)).toEqual([]);
  });
  test("scalars use the registry's labels and formats", () => {
    expect(describeChanges(profile, after([{ path: ["people", "self", "salary"], value: 400_000 }]))).toEqual(["Your base salary: $320,000 → $400,000"]);
    expect(describeChanges(profile, after([{ path: ["assumptions", "fmvGrowth"], value: 0.2 }]))).toEqual(["Share value growth: 15% → 20%"]);
    expect(describeChanges(profile, after([{ path: ["assumptions", "state", "waMillionairesTax"], value: false }]))[0]).toMatch(/^WA millionaires' tax \(on\/off\): (on → )?off$/);
  });
  test("decisions are described by event, not by index", () => {
    const p = tools.proposeScenario(profile, "sell half", [{ kind: "sell", year: 2027, shares: 2_000 }]);
    const lines = describeChanges(profile, after(p.edits));
    expect(lines[0]).toMatch(/^Scenario "sell half" created: proposed by your agent .*, with exercise 4,000 ISO shares in 2026; sell 2,000 shares in 2027$/);
    const moved = after([{ path: ["scenarios", "default", "events", 0, "year"], value: 2027 }]);
    expect(describeChanges(profile, moved)).toEqual(["Changed exercise 4,000 ISO shares in 2026 → exercise 4,000 ISO shares in 2027"]);
    expect(describeChanges(profile, after([{ path: ["activeScenario"], value: "default" }]))).toEqual([]);
  });
  test("agent proposals, documents and answers read as such", () => {
    const u = tools.updateFacts(profile, [{ field: "salary", value: 400_000, from: 2028, source: "told in chat" }]);
    const withPending = after(u.edits);
    expect(describeChanges(profile, withPending)).toEqual(["Proposed Your base salary: $400,000 from 2028 (told in chat)"]);
    expect(describeChanges(withPending, profile)).toEqual(["Proposal resolved: Your base salary: $400,000 from 2028"]);
    const sent = after(tools.submitIntake(profile, "taxonomy_intake: 1\npeople:\n  self:\n    baseSalary: 1\n", ["pay"]).edits);
    expect(describeChanges(profile, sent)).toEqual(["Sent a document (pay) for review"]);
    expect(describeChanges(sent, profile)).toEqual(["Reviewed a document (pay)"]);
  });
  test("equity items by id, and a new profile", () => {
    const gone = after([{ path: ["equity", "grants"], value: profile.equity.grants.slice(1) }]);
    expect(describeChanges(profile, gone)).toEqual([`Grant removed: ${profile.equity.grants[0]!.name}`]);
    expect(describeChanges(profile, after([{ path: ["equity", "companies", 0, "growth"], value: 0.2 }]))).toEqual(["Example Inc.: Share value growth for this company: 20%"]);
    expect(describeChanges(profile, after([{ path: ["equity", "grants", 0, "strike"], value: 3 }]))).toEqual([`${profile.equity.grants[0]!.name}: strike: 2 → 3`]);
    expect(describeChanges(null, profile)).toEqual([`Profile "${profile.name}" created`]);
    expect(describeChanges(profile, after([{ path: ["sources", "people.self.salary"], value: "x" }]))).toEqual([]);
  });
});

test("dependents are described as people, not paths", () => {
  const { readFileSync } = require("node:fs");
  const { parseProfile, editProfileText } = require("../src/profile.ts");
  const { describeChanges } = require("../src/history.ts");
  const text = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");
  const before = parseProfile(text);
  const after = parseProfile(editProfileText(text, [{ path: ["filer", "dependents"], value: [{ birthYear: 2015 }, { birthYear: 2019 }] }]));
  const lines = describeChanges(before, after);
  expect(lines).toContain("Dependents: none → 2015, 2019");
  expect(lines.some((l: string) => l.includes("birthYear"))).toBe(false);
});
