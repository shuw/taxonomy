import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile, editProfileText } from "../src/profile.ts";
import { parseIntake, unfence } from "../src/intake/schema.ts";
import { reviewIntake, changesToEdits, followUpEdits, toGrant } from "../src/intake/apply.ts";
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
    expect(parseIntake(JSON.stringify({ taxonomy_intake: 1, income: { interest: 100 } })).doc?.income?.interest).toBe(100);
  });
  test("reports precise problems", () => {
    const r = parseIntake("taxonomy_intake: 1\nequity:\n  grants:\n    - name: x\n      type: warrant\n    - name: y\n      type: iso\n      granted: 10\nhome:\n  mortgage: { rate: 0.05 }\n");
    expect(r.doc).toBeNull();
    expect(r.problems.map((p) => p.path)).toEqual(expect.arrayContaining(["equity.grants[0].type", "equity.grants[1].strike", "home.mortgage"]));
    // A mortgage with only its balance is accepted; the rest becomes questions.
    const partial = parseIntake("taxonomy_intake: 1\nhome:\n  mortgage: { balance: 500000 }\n");
    expect(partial.problems).toEqual([]);
    expect(partial.warnings.map((w) => w.path)).toContain("home.mortgage");
  });
  test("unfence finds the document inside a chatty reply", () => {
    expect(unfence("```yaml\na: 1\n```")).toBe("a: 1");
    expect(unfence("a: 1")).toBe("a: 1");
    expect(unfence("Here is what I found.\n\n```yaml\ntaxonomy_intake: 1\nincome:\n  interest: 5\n```\n\nLet me know if anything is off.")).toBe("taxonomy_intake: 1\nincome:\n  interest: 5");
    const r = parseIntake("Summary line one.\nSummary line two.\n```yaml\ntaxonomy_intake: 1\nincome: { interest: 7 }\n```");
    expect(r.doc?.income?.interest).toBe(7);
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
    expect(byId["equity.companies.0.sharePrice"]!.proposed).toBe(21);
    expect(byId["income.interest"]!.status).toBe("changed");
    expect(byId["assumptions.fmvGrowth"]!.status).toBe("same");
    expect(byId["grants.g1"]!.format).toBe("grant");
    expect(byId["grants.g1"]!.status).toBe("changed");
    expect(byId["grants.g3"]!.status).toBe("new");
    expect(byId["returns.2025"]!.status).toBe("new");
    expect(review.unknown.map((u) => u.path)).toContain("people.self.expectedBonus");
    expect(review.questions).toHaveLength(1);
    expect(review.questions[0]!.question).toContain("Form 3921");
  });
  test("grants convert with unexercised as shares and vested net of exercised", () => {
    const iso = toGrant(doc.equity!.grants![0]!, "g1", "c1");
    expect(iso).toMatchObject({ id: "g1", type: "iso", granted: 60_000, vestedToDate: 52_500, exercisedToDate: 12_500, strike: 2, company: "c1" });
    expect(iso.schedule?.cadence).toBe("monthly");
    const nso = toGrant(doc.equity!.grants![1]!, "g3");
    expect(nso).toMatchObject({ type: "nso", granted: 12_000, vestedToDate: 3_000 });
    expect(nso.vesting).toEqual({ "2026-06-01": 3_000, "2027-06-01": 3_000 });
    const rsu = toGrant(doc.equity!.grants![2]!, "g2");
    expect(rsu).toMatchObject({ type: "rsu", granted: 8_000, vestedToDate: 3_500 });
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
    expect(p.equity.grants[0]!.granted).toBe(60_000);
    expect(p.equity.grants[0]!.exercisedToDate).toBe(12_500);
    expect(p.equity.holdings?.[0]?.amtBasis).toBe(16.5);
    expect(p.home?.mortgage?.balance).toBe(812_000);
    expect(p.sources?.["people.self.salary"]).toContain("pay stub");
    expect(p.sources?.["grants.g1"]).toContain("Shareworks");
    expect(p.returns?.[0]?.reported.totalTax).toBe(87_201);
    expect(p.equity.companies[0]!.sharePrice).toBe(21);
    const plan = runPlan(p);
    expect(plan.years[0]!.lines.mortgageInterest!.value).toBeGreaterThan(0);
    expect(plan.years[0]!.lines.amtCreditCarryforwardIn!.value).toBe(18_960);
    const cal = calibrate(p)!;
    expect(cal.rows.find((r) => r.id === "agi")!.reported).toBe(402_113);
  });
});

describe("follow-ups", () => {
  test("structured and plain questions become follow-ups tied to profile paths", () => {
    const r = parseIntake(`taxonomy_intake: 1
prior_return: { year: 2025, filingStatus: married_filing_jointly, amtCreditCarryforward: 67148 }
equity:
  grants:
    - { name: New-hire ISO, type: iso, granted: 100, strike: 1 }
questions:
  - { about: prior_return.amtCreditCarryforward, proposed: 67148, question: "No Form 8801; used the CPA worksheet." }
  - { about: "equity.grants[0]", question: "Vesting read from portal counts only." }
  - "The 78-share lot origin is unknown."
`);
    expect(r.problems).toEqual([]);
    expect(r.doc!.prior_return!.filingStatus).toBe("mfj");
    const review = reviewIntake(r.doc!, profile);
    const edits = followUpEdits(review, profile);
    const list = edits[0]!.value as { text: string; about?: string }[];
    expect(list).toHaveLength(4);
    expect(list[0]!.text).toContain("no vesting schedule");
    expect(list[0]!.about).toBe("grants.g3");
    expect(list[1]!.about).toBe("carryforwards.amtCredit");
    expect(list[2]!.about).toBe("grants.g3");
    expect(list[3]!.about).toBeUndefined();
    const text = editProfileText(example, [...changesToEdits(review.changes, profile), ...edits]);
    expect(parseProfile(text).followUps).toHaveLength(4);
  });
});

describe("intake prompt", () => {
  test("includes the chosen sections, the rules, and the current profile", () => {
    const text = intakePrompt({ sections: ["pay", "equity"], profile });
    expect(text).toContain("placeholders, not facts");
    expect(text).toContain("filingStatus: single");
    expect(intakePrompt({ sections: ["basics"], profile })).not.toContain("filer:");
    expect(text).toContain("taxonomy_intake: 1");
    expect(text).toContain("baseSalary:");
    expect(text).toContain("unexercised:");
    expect(text).not.toContain("prior_return:");
    expect(text).toContain("Never estimate");
    expect(text).toContain("## How we'll work");
    expect(text).toContain("Look hardest for these");
    expect(text).toContain("Don't wait on me for simple facts");
    expect(text).toContain("people.self.baseSalary");
    expect(text).toContain("equity.sharePrice.value");
    expect(text).toContain("never exercised");
    expect(text).toContain("## What the tool already has");
    expect(text).toContain("no bonus");
    expect(text).not.toContain("scenarios:");
    expect(text).not.toContain("prior_return.agi (1040 line 11)");
    expect(text).toContain("sharePrice: 18");
    expect(text).toContain("granted: 40000");
    expect(text).toContain("1040 line 11");
    expect(INTAKE_SECTIONS.map((s) => s.id)).toHaveLength(8);
  });
  test("a follow-up restricts to the listed paths", () => {
    const text = intakePrompt({ sections: ["basics"], onlyPaths: ["people.self.expectedBonus"] });
    expect(text).toContain("report only these paths: people.self.expectedBonus");
  });
});

describe("dependents", () => {
  test("birth years are accepted and become dependents with ages", () => {
    const { parseIntake } = require("../src/intake/schema.ts") as typeof import("../src/intake/schema.ts");
    const { reviewIntake, changesToEdits } = require("../src/intake/apply.ts") as typeof import("../src/intake/apply.ts");
    const { parseProfile } = require("../src/profile.ts") as typeof import("../src/profile.ts");
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const profile = parseProfile(readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8"));
    const parsed = parseIntake("taxonomy_intake: 1\npay:\n  dependents: [2019, 2022]\n");
    expect(parsed.problems).toEqual([]);
    expect(parsed.doc?.pay?.dependents).toEqual([{ birthYear: 2019 }, { birthYear: 2022 }]);
    const review = reviewIntake(parsed.doc!, profile);
    const row = review.changes.find((c) => c.id === "filer.dependents")!;
    expect(row.proposed).toBe("2019, 2022");
    const edits = changesToEdits([row], profile);
    expect(edits.find((e) => e.path.join(".") === "filer.dependents")?.value).toEqual([{ birthYear: 2019 }, { birthYear: 2022 }]);
    const count = parseIntake("taxonomy_intake: 1\npay:\n  dependents: 2\n");
    expect(reviewIntake(count.doc!, profile).changes.find((c) => c.id === "filer.dependents")?.proposed).toBe("2");
  });
});

describe("a $100k split reported tranche by tranche", () => {
  test("the NSO's own dated vests fold into the ISO's map and the NSO carries none", () => {
    const profile = parseProfile(example);
    const r = parseIntake(`taxonomy_intake: 1\nequity:\n  grants:\n    - { name: "2026 ISO", type: iso, granted: 3000, strike: 40, vested: 0, exercised: 0, vesting: [{ date: 2027-06-01, shares: 2500 }, { date: 2028-06-01, shares: 500 }] }\n    - { name: "2026 NSO (split)", type: nso, granted: 5000, strike: 40, vested: 0, exercised: 0, splitOf: "2026 ISO", vesting: [{ date: 2027-06-01, shares: 1500 }, { date: 2028-06-01, shares: 3500 }] }\n`);
    expect(r.problems).toEqual([]);
    const review = reviewIntake(r.doc!, profile);
    const grants = review.changes.filter((c) => c.format === "grant").map((c) => c.proposed as { type: string; vesting?: Record<string, number>; splitOf?: string; schedule?: unknown });
    const iso = grants.find((g) => g.type === "iso")!, nso = grants.find((g) => g.type === "nso")!;
    expect(iso.vesting).toEqual({ "2027-06-01": 4_000, "2028-06-01": 4_000 });
    expect(nso.vesting).toBeUndefined();
    expect(nso.schedule).toBeUndefined();
    expect(nso.splitOf).toBeDefined();
  });
});

describe("the grant list is the whole list", () => {
  test("a grant on file that the documents no longer show is removed, and its source with it", () => {
    const text = editProfileText(readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8"), [{ path: ["sources", "grants.g2"], value: "old portal export" }]);
    const profile = parseProfile(text);
    const r = parseIntake(`taxonomy_intake: 1\nequity:\n  grants:\n    - { name: "2023 ISO grant", type: iso, granted: 40000, strike: 2, vested: 40000, exercised: 0, unexercised: 40000 }\n`);
    expect(r.problems).toEqual([]);
    const review = reviewIntake(r.doc!, profile);
    const gone = review.changes.find((c) => c.id === "grants.g2");
    expect(gone?.proposed).toBeUndefined();
    expect(gone?.note).toContain("removed");
    const after = parseProfile(editProfileText(text, changesToEdits(review.changes.filter((c) => c.status !== "same"), profile)));
    expect(after.equity.grants.map((g) => g.id)).toEqual(["g1"]);
    expect(after.sources?.["grants.g2"]).toBeUndefined();
  });
});
