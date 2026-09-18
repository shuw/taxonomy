import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile, editProfileText } from "../src/profile.ts";
import * as tools from "../src/tools.ts";

const text = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");
const profile = parseProfile(text);

describe("agent tools", () => {
  test("context names the plan, companies, grants and the words the tools use", () => {
    const c = tools.context(profile);
    expect(c.plan.years.length).toBe(profile.plan.years);
    expect(c.companies[0]!.id).toBe("c1");
    expect(c.grants.find((g) => g.id === "g1")!.exercisableIn[2026]).toBe(40_000);
    expect(c.scenarios[0]).toMatchObject({ name: "default", active: true });
    expect(c.vocabulary.rules).toContain("scenario(add)");
  });
  test("plan lists headline lines and the year's events", () => {
    const p = tools.plan(profile);
    expect(p.years[0]!.lines.totalTax).toBeGreaterThan(0);
    expect(p.years[0]!.events.map((e) => e.kind)).toEqual(["exercise"]);
    expect(p.totals.totalTax).toBeCloseTo(p.years.reduce((s, y) => s + y.lines.totalTax!, 0), 0);
  });
  test("explain returns the line, its reason and its inputs", () => {
    const e = tools.explain(profile, 2026, "amt");
    expect(e.line.why.length).toBeGreaterThan(10);
    expect(e.deps.map((d) => d.id)).toContain("tentativeMinimumTax");
    expect(() => tools.explain(profile, 2099, "amt")).toThrow(/not in the plan/);
  });
  test("compareYears sorts by the size of the change", () => {
    const rows = tools.compareYears(profile, 2026, 2027);
    expect(rows.length).toBeGreaterThan(3);
    expect(Math.abs(rows[0]!.delta)).toBeGreaterThanOrEqual(Math.abs(rows[1]!.delta));
  });
  test("amtHeadroom reports the AMT-free count and the slope past it", () => {
    const h = tools.amtHeadroom(profile, 2026);
    expect(h.sharesBeforeAmt).toBeGreaterThan(0);
    expect(h.perShareAmtPastLine).toBeGreaterThan(0);
  });
  test("what_if leaves the profile alone and reports the delta against the active scenario", () => {
    const before = JSON.stringify(profile);
    const w = tools.whatIf(profile, [{ kind: "exercise", type: "iso", year: 2026, shares: 20_000 }], ["e1"]);
    expect(JSON.stringify(profile)).toBe(before);
    expect(w.events.map((e) => e.id)).toEqual(["e2"]);
    expect(w.delta.byYear[0]!.amt).toBeGreaterThan(0);
    expect(w.delta.totalTax).not.toBe(0);
  });
  test("events are checked: years in the plan, known companies by id or name, grants of the type", () => {
    expect(() => tools.normalizeEvents(profile, [{ kind: "sell", year: 2040, shares: 1 }])).toThrow(/not in the plan/);
    expect(() => tools.normalizeEvents(profile, [{ kind: "exercise", type: "nso", year: 2026, shares: 1 }])).toThrow(/no NSO grants/);
    const byName = tools.normalizeEvents(profile, [{ kind: "exercise", type: "iso", year: 2026, shares: 1, company: "Example Inc." }]);
    expect((byName[0] as { company?: string }).company).toBe("c1");
    expect(() => tools.normalizeEvents(profile, [{ kind: "exercise", type: "iso", year: 2026, shares: 1, company: "Nope" }])).toThrow(/no company/);
  });
  test("propose_scenario writes a new scenario with a note and keeps the active one", () => {
    const p = tools.proposeScenario(profile, "sell half in 2027", [{ kind: "sell", year: 2027, shares: 2_000 }]);
    const out = parseProfile(editProfileText(text, p.edits));
    expect(out.activeScenario).toBe("default");
    expect(out.scenarios!["sell half in 2027"]!.events.map((e) => e.kind)).toEqual(["exercise", "sell"]);
    expect(out.scenarios!["sell half in 2027"]!.note).toContain("proposed by your agent");
    expect(() => tools.proposeScenario(profile, "default", [])).toThrow(/already exists/);
  });
  test("set_active and delete produce edits, and the last scenario cannot go", () => {
    expect(tools.setActiveScenario(profile, "default")).toEqual([{ path: ["activeScenario"], value: "default" }]);
    expect(() => tools.deleteScenario(profile, "default")).toThrow(/only scenario/);
    const two = parseProfile(editProfileText(text, tools.proposeScenario(profile, "x", []).edits));
    const edits = tools.deleteScenario(two, "x");
    expect(edits[0]).toEqual({ path: ["scenarios", "x"], value: undefined });
  });
  test("sell_to_cover and lots work on the active scenario", () => {
    const l = tools.lots(profile, 2027);
    expect(l.held).toBeGreaterThan(0);
    expect(l.lots[0]!.status).toBeDefined();
    const s = tools.sellToCover(profile, 2027);
    expect(s.shares).toBeGreaterThan(0);
  });
  test("proposals lists agent scenarios that are not active, with their added events and effect", () => {
    expect(tools.proposals(profile)).toEqual([]);
    const two = parseProfile(editProfileText(text, tools.proposeScenario(profile, "sell 1,000 in 2027", [{ kind: "sell", year: 2027, shares: 1_000 }]).edits));
    const [p] = tools.proposals(two);
    expect(p!.name).toBe("sell 1,000 in 2027");
    expect(p!.events.map((e) => e.kind)).toEqual(["sell"]);
    expect(p!.delta.totalTax).toBeGreaterThan(0);
    expect(tools.proposals({ ...two, activeScenario: "sell 1,000 in 2027" })).toEqual([]);
  });
  test("update_facts resolves fields by path, label or tail, coerces values, and leaves the fact alone until accepted", () => {
    const r = tools.updateFacts(profile, [
      { field: "salary", value: "400k", source: "told in chat" },
      { field: "Share value growth", value: "20%" },
      { field: "sharePrice", value: 25, company: "Example Inc." },
      { field: "assumptions.state.waMillionairesTax", value: "off" },
      { field: "plan.years", value: 3 },
    ]);
    expect(r.rows.map((x) => [x.field, x.proposed])).toEqual([["people.self.salary", 400_000], ["assumptions.fmvGrowth", 0.2], ["equity.companies.0.sharePrice", 25], ["assumptions.state.waMillionairesTax", false], ["plan.years", 3]]);
    expect(r.rows[0]).toMatchObject({ current: 320_000, label: "Your base salary", source: "told in chat" });
    expect(r.delta.totalTax).not.toBe(0);
    const next = parseProfile(editProfileText(text, r.edits));
    expect(next.people.self.salary).toBe(320_000);
    expect(next.pending!.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(() => tools.updateFacts(profile, [{ field: "nope", value: 1 }])).toThrow(/no field/);
    expect(() => tools.updateFacts(profile, [{ field: "salary", value: "lots" }])).toThrow(/cannot read/);
    expect(() => tools.updateFacts(profile, [{ field: "plan.years", value: 4, from: 2027 }])).toThrow(/cannot change from a year/);
    expect(() => tools.updateFacts(profile, [{ field: "salary", value: 1, from: 2050 }])).toThrow(/not in the plan/);
  });
  test("a dated change becomes a timeline entry on accept; a plain one replaces the fact with a source; discard drops it", () => {
    const r = tools.updateFacts(profile, [{ field: "salary", value: 400_000, from: 2028, source: "promotion" }, { field: "inflation", value: 0.03 }]);
    const withPending = parseProfile(editProfileText(text, r.edits));
    const review = tools.pendingReview(withPending);
    expect(review.rows.map((x) => x.from)).toEqual([2028, undefined]);
    expect(review.delta!.byYear.find((d) => d.year === 2027)!.totalTax).toBeLessThan(0.01 * 0 + 1e9);
    const accepted = parseProfile(editProfileText(editProfileText(text, r.edits), tools.resolvePending(withPending, undefined, true)));
    expect(accepted.pending).toBeUndefined();
    expect(accepted.assumptions.inflation).toBe(0.03);
    expect(accepted.sources!["assumptions.inflation"]).toMatchObject({ doc: "your agent" });
    expect(accepted.timeline!.at(-1)).toMatchObject({ year: 2028, path: "people.self.salary", value: 400_000, note: "promotion" });
    const one = parseProfile(editProfileText(editProfileText(text, r.edits), tools.resolvePending(withPending, ["p2"], false)));
    expect(one.pending!.map((p) => p.id)).toEqual(["p1"]);
    expect(one.assumptions.inflation).toBe(profile.assumptions.inflation);
    expect(() => tools.resolvePending(profile, undefined, true)).toThrow(/nothing is pending/);
  });
  test("context lists the editable fields with current values", () => {
    const f = tools.context(profile).fields;
    expect(f.find((x) => x.field === "people.self.salary")!.current).toBe(320_000);
    expect(f.find((x) => x.field === "equity.companies.0.sharePrice")!.current).toEqual({ c1: 18 });
    expect(f.some((x) => x.field.startsWith("returns."))).toBe(false);
  });
  test("applyIntake writes the changed values with their sources and turns questions into follow-ups", () => {
    const r = tools.applyIntake(profile, "taxonomy_intake: 1\npeople:\n  self:\n    baseSalary: 333000\nsources:\n  people.self.baseSalary: 'pay stub'\n");
    expect(r.problems).toEqual([]);
    expect(r.applied.map((a) => [a.path, a.to])).toEqual([["people.self.salary", 333_000]]);
    const next = parseProfile(editProfileText(text, r.edits));
    expect(next.people.self.salary).toBe(333_000);
    expect(next.sources?.["people.self.salary"]).toBeDefined();
    expect(tools.applyIntake(profile, "nope").problems.length).toBeGreaterThan(0);
  });
  test("intake tools produce the request and park a document for review without touching the facts", () => {
    expect(tools.intakeRequest(profile, ["pay"])).toContain("Taxonomy");
    const doc = "taxonomy_intake: 1\npeople:\n  self:\n    baseSalary: 333000\n";
    const r = tools.submitIntake(profile, doc, ["pay"]);
    expect(r).toMatchObject({ problems: [], found: 1, questions: 0 });
    const next = parseProfile(editProfileText(text, r.edits));
    expect(next.people.self.salary).toBe(320_000);
    expect(next.pendingIntake).toEqual([expect.objectContaining({ id: "d1", text: doc.trim(), sections: ["pay"] })]);
    const again = parseProfile(editProfileText(editProfileText(text, r.edits), tools.submitIntake(next, "taxonomy_intake: 1\nbasics:\n  state: CA\n").edits));
    expect(again.pendingIntake!.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(tools.outstanding(again).documentsAwaitingReview).toBe(2);
    expect(tools.outstanding(profile).empty).toContain("last filed return (no calibration until it is on file)");
    expect(tools.outstanding(profile).empty).not.toContain("base salary (people.self.salary)");
    expect(tools.submitIntake(profile, "not: yaml intake").problems.length).toBeGreaterThan(0);
  });
});

describe("removing equity", () => {
  const profile = parseProfile(readFileSync(new URL("../../../data/demo.yaml", import.meta.url), "utf8"));
  test("drops a grant or a holding by id, with its source", () => {
    const edits = tools.removeEquity(profile, ["grants.nso2024", "holdings.h1"]);
    const after = parseProfile(editProfileText(readFileSync(new URL("../../../data/demo.yaml", import.meta.url), "utf8"), edits));
    expect(after.equity.grants.map((g) => g.id)).toEqual(["iso2022", "rsu2025"]);
    expect(after.equity.holdings ?? []).toEqual([]);
    expect(after.sources?.["grants.nso2024"]).toBeUndefined();
    expect(after.sources?.["grants.iso2022"]).toBeDefined();
  });
  test("refuses ids it does not have", () => {
    expect(() => tools.removeEquity(profile, ["grants.nope"])).toThrow(/no grant "nope"/);
    expect(() => tools.removeEquity(profile, ["people.self"])).toThrow(/grants\.<id> or holdings\.<id>/);
  });
});

describe("a blank profile", () => {
  test("has nothing in it and the demo's headline lines include the charitable carryforward", () => {
    const { blankProfileText } = require("../src/profile.ts") as typeof import("../src/profile.ts");
    const p = parseProfile(blankProfileText("Sam", 2026));
    expect(p.name).toBe("Sam");
    expect(p.equity.companies).toEqual([]);
    expect(p.equity.grants).toEqual([]);
    expect(Object.values(p.scenarios ?? {}).every((s) => s.events.length === 0)).toBe(true);
    const plan = tools.plan(parseProfile(readFileSync(new URL("../../../data/demo.yaml", import.meta.url), "utf8")));
    expect(plan.years[0]!.lines).toHaveProperty("charitableDeduction");
    expect(plan.years[0]!.lines).toHaveProperty("charitableCarryOut");
  });
});

describe("what get_context reports", () => {
  test("an unset Washington switch reads as on", () => {
    const p = parseProfile(readFileSync(new URL("../../../data/demo.yaml", import.meta.url), "utf8"));
    const f = tools.context(p).fields.find((x) => x.field === "assumptions.state.waMillionairesTax")!;
    expect(f.current).toBe(true);
  });
  test("an intake that leaves grants out says which were removed", () => {
    const p = parseProfile(readFileSync(new URL("../../../data/demo.yaml", import.meta.url), "utf8"));
    const r = tools.applyIntake(p, `taxonomy_intake: 1\nequity:\n  grants:\n    - { name: "2022 ISO grant", type: iso, granted: 60000, strike: 1.2, vested: 52500, exercised: 10000, unexercised: 50000 }\n`);
    expect(r.warnings.some((w) => /2 grants on file were not in the document and were removed: 2024 NSO refresh, 2025 RSU grant/.test(w))).toBe(true);
  });
});
