import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile, editProfileText } from "../src/profile.ts";
import { parseIntake, unfence } from "../src/intake/schema.ts";
import { reviewIntake, changesToEdits, toGrant } from "../src/intake/apply.ts";
import { intakePrompt, INTAKE_SECTIONS } from "../src/intake/prompt.ts";
import { runPlan } from "../src/plan.ts";
import { calibrate } from "../src/calibration.ts";

const example = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");
const fixture = readFileSync(new URL("./fixtures/intake.yaml", import.meta.url), "utf8");
const profile = parseProfile(example);

describe("intake parsing", () => {
  test("accepts a fenced, slightly messy document and normalizes it", () => {
    const r = parseIntake(fixture);
    expect(r.problems).toEqual([]);
    const d = r.doc!;
    expect(d.basics?.filingStatus).toBe("mfj");
    expect(d.basics?.state).toBe("WA");
    expect(d.people?.self?.baseSalary).toBe(620_000);
    expect(r.warnings.some((w) => w.path === "people.self.baseSalary")).toBe(true);
    expect(d.equity?.grants?.[0]?.type).toBe("iso");
    expect(d.equity?.grants?.[1]?.type).toBe("nqso");
    expect(d.home?.mortgage?.rate).toBeCloseTo(0.0575);
    expect(d.unknown).toHaveLength(2);
  });
  test("accepts JSON too", () => {
    const r = parseIntake(JSON.stringify({ taxonomy_intake: 1, income: { interest: 100 } }));
    expect(r.doc?.income?.interest).toBe(100);
  });
  test("reports precise problems", () => {
    const r = parseIntake("taxonomy_intake: 1\nequity:\n  grants:\n    - name: x\n      type: warrant\n    - name: y\n      type: iso\n      granted: 10\nhome:\n  mortgage: { balance: 1 }\n");
    expect(r.doc).toBeNull();
    expect(r.problems.map((p) => p.path)).toEqual(expect.arrayContaining(["equity.grants[0].type", "equity.grants[1].strike", "home.mortgage"]));
  });
  test("unfence strips a code fence", () => {
    expect(unfence("```yaml\na: 1\n```")).toBe("a: 1");
    expect(unfence("a: 1")).toBe("a: 1");
  });
});

describe("intake review and apply", () => {
  const doc = parseIntake(fixture).doc!;
  const review = reviewIntake(doc, profile);
  test("lists changes with status and source", () => {
    const byId = Object.fromEntries(review.changes.map((c) => [c.id, c]));
    expect(byId["filer.filingStatus"]!.status).toBe("changed");
    expect(byId["people.self.salary"]!.proposed).toBe(620_000);
    expect(byId["people.self.salary"]!.source).toContain("pay stub");
    expect(byId["people.spouse.salary"]!.status).toBe("new");
    expect(byId["carryforwards.amtCredit"]!.proposed).toBe(18_960);
    expect(byId["carryforwards.amtCredit"]!.source).toContain("8801");
    expect(byId["equity.sharePrice"]!.note).toContain("409A");
    expect(byId["income.interest"]!.status).toBe("changed");
    expect(byId["assumptions.fmvGrowth"]!.status).toBe("same");
    expect(byId["equity.grants.0"]!.format).toBe("grant");
    expect(byId["equity.grants.2"]!.status).toBe("new");
    expect(byId["priorReturn"]!.status).toBe("new");
    expect(review.unknown.map((u) => u.path)).toContain("people.self.expectedBonus");
    expect(review.questions).toHaveLength(1);
  });
  test("grants convert with unexercised as shares and vested net of exercised", () => {
    const iso = toGrant(doc.equity!.grants![0]!);
    expect(iso).toMatchObject({ type: "iso", shares: 47_500, vested: 40_000, strike: 2, granted: 60_000 });
    expect(iso.schedule?.cadence).toBe("monthly");
    const nso = toGrant(doc.equity!.grants![1]!);
    expect(nso).toMatchObject({ type: "nso", shares: 12_000, vested: 3_000 });
    expect(nso.vesting).toEqual({ 2026: 3_000, 2027: 3_000 });
    const rsu = toGrant(doc.equity!.grants![2]!);
    expect(rsu).toMatchObject({ type: "rsu", shares: 8_000, vested: 3_500 });
    expect(rsu.strike).toBeUndefined();
  });
  test("accepted changes become edits that produce a valid, richer profile", () => {
    const accepted = review.changes.filter((c) => c.status !== "same");
    const text = editProfileText(example, changesToEdits(accepted, profile));
    const p = parseProfile(text);
    expect(p.filer.filingStatus).toBe("mfj");
    expect(p.people.self.salary).toBe(620_000);
    expect(p.people.spouse?.salary).toBe(150_000);
    expect(p.carryforwards?.amtCredit).toBe(18_960);
    expect(p.carryforwards?.capitalLoss?.longTerm).toBe(3_200);
    expect(p.equity.grants.map((g) => g.type)).toEqual(["iso", "rsu", "nso"]);
    expect(p.equity.grants[0]!.shares).toBe(47_500);
    expect(p.equity.holdings?.[0]?.amtBasis).toBe(16.5);
    expect(p.home?.mortgage?.balance).toBe(812_000);
    expect(p.sources?.["people.self.salary"]).toContain("pay stub");
    expect(p.priorReturn?.reported.totalTax).toBe(87_201);
    const plan = runPlan(p);
    expect(plan.years[0]!.lines.mortgageInterest!.value).toBeGreaterThan(0);
    expect(plan.years[0]!.lines.amtCreditCarryforwardIn!.value).toBe(18_960);
    const cal = calibrate(p)!;
    expect(cal.rows.find((r) => r.id === "agi")!.reported).toBe(402_113);
  });
});

describe("intake prompt", () => {
  test("includes the chosen sections, the rules, and the current profile", () => {
    const text = intakePrompt({ sections: ["basics", "equity"], profile });
    expect(text).toContain("taxonomy_intake: 1");
    expect(text).toContain("baseSalary:");
    expect(text).toContain("unexercised:");
    expect(text).not.toContain("prior_return:");
    expect(text).toContain("Never estimate");
    expect(text).toContain("sharePrice: 18");
    expect(INTAKE_SECTIONS.map((s) => s.id)).toHaveLength(6);
  });
  test("a follow-up restricts to the listed paths", () => {
    const text = intakePrompt({ sections: ["basics"], onlyPaths: ["people.self.expectedBonus"] });
    expect(text).toContain("Only report these paths: people.self.expectedBonus");
  });
});
