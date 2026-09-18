import { describe, expect, test } from "bun:test";
import { Ledger } from "../src/ledger.ts";
import { computeFederal } from "../src/federal.ts";
import { FEDERAL_2026, federalParams } from "../src/params.ts";
import type { YearInputs } from "../src/types.ts";

const base: YearInputs = {
  year: 2026, filingStatus: "single", state: "WA",
  salarySelf: 0, salarySpouse: 0, pretaxContributions: 0, otherOrdinary: 0, interest: 0, nonqualifiedDividends: 0, qualifiedDividends: 0, longTermGains: 0, shortTermGains: 0,
  capitalLossCarryIn: { shortTerm: 0, longTerm: 0 },
  mortgageInterestPaid: 0, mortgageCapFraction: 1, propertyTax: 0, stateIncomeTax: 0, charitableCash: 0, charitableStock: 0, charitableCarryIn: 0, medical: 0,
  isoSharesExercised: 0, isoBargainElement: 0, nsoSharesExercised: 0, nsoIncome: 0, rsuSharesVested: 0, rsuIncome: 0, sharesSold: 0, saleProceeds: 0, exerciseCost: 0, isoDisqualifyingIncome: 0, amtCapitalAdjustment: 0, amtCreditCarryforwardIn: 0, bracketRateDelta: 0,
};

function fed(over: Partial<YearInputs>) {
  const ledger = new Ledger();
  computeFederal({ ...base, ...over }, federalParams(over.year ?? 2026, 0.025, over.bracketRateDelta ?? 0), ledger);
  return ledger;
}


describe("regular tax", () => {
  test("SALT: capped, phased down to the floor over $505k, itemizing when it wins, and the reason says so", () => {
    const L = fed({ salarySelf: 200_000, propertyTax: 30_000, mortgageInterestPaid: 20_000 });
    expect(L.get("saltDeduction")).toBe(30_000);
    expect(L.get("usesItemized")).toBe(1);
    expect(fed({ salarySelf: 200_000, propertyTax: 50_000 }).get("saltDeduction")).toBe(40_400);
    expect(fed({ salarySelf: 600_000, propertyTax: 50_000 }).get("saltCap")).toBeCloseTo(40_400 - 0.3 * 95_000);
    const floor = fed({ salarySelf: 2_000_000, propertyTax: 50_000 });
    expect(floor.get("saltCap")).toBe(10_000);
    expect(floor.lines.saltDeduction!.why).toMatch(/capped at \$10,000 this year \(the \$40,400 cap shrinks/);
  });
  test("NIIT: 3.8% of investment income over the threshold, after the capital-loss deduction", () => {
    expect(fed({ salarySelf: 250_000, interest: 20_000 }).get("niit")).toBeCloseTo(20_000 * 0.038);
    expect(fed({ salarySelf: 190_000, interest: 20_000 }).get("niit")).toBeCloseTo(10_000 * 0.038);
    const withLoss = fed({ salarySelf: 400_000, interest: 50_000, shortTermGains: -20_000 });
    expect(withLoss.get("capitalLossDeduction")).toBe(3_000);
    expect(withLoss.get("niit")).toBeCloseTo(fed({ salarySelf: 400_000, interest: 50_000 }).get("niit") - 3_000 * 0.038, 2);
    expect(withLoss.lines.niit!.why).toContain("capital-loss deduction");
  });
});

describe("AMT", () => {
  test("no AMT without preferences at moderate income", () => {
    expect(fed({ salarySelf: 300_000 }).get("amt")).toBe(0);
  });
  test("ISO bargain element creates AMT and a credit", () => {
    const L = fed({ salarySelf: 300_000, isoSharesExercised: 20_000, isoBargainElement: 320_000 });
    expect(L.get("amt")).toBeGreaterThan(0);
    expect(L.get("amtCreditGenerated")).toBeCloseTo(L.get("amt"));
    expect(L.get("amti")).toBe(300_000 + 320_000);
  });
  test("exemption phases out at 50% above $500k AMTI", () => {
    const L = fed({ salarySelf: 400_000, isoBargainElement: 150_000 });
    const excess = 550_000 - 500_000;
    expect(L.get("amtExemption")).toBeCloseTo(90_100 - 0.5 * excess);
    const L2 = fed({ salarySelf: 400_000, isoBargainElement: 400_000 });
    expect(L2.get("amtExemption")).toBe(0);
  });
  test("AMT credit is used only down to tentative minimum tax", () => {
    const L = fed({ salarySelf: 300_000, amtCreditCarryforwardIn: 100_000 });
    const room = L.get("regularTax") - L.get("tentativeMinimumTax");
    expect(room).toBeGreaterThan(0);
    expect(L.get("amtCreditUsed")).toBeCloseTo(Math.min(100_000, room));
    expect(L.get("amtCreditCarryforwardOut")).toBeCloseTo(100_000 - L.get("amtCreditUsed"));
  });
  test("AMT from the SALT addback alone is not creditable", () => {
    const L = fed({ salarySelf: 200_000, propertyTax: 40_000, mortgageInterestPaid: 30_000, isoBargainElement: 200_000 });
    expect(L.get("amtCreditGenerated")).toBeLessThanOrEqual(L.get("amt"));
  });
  test("capital gains keep preferential rates inside AMT", () => {
    const a = fed({ salarySelf: 300_000, longTermGains: 200_000 });
    const b = fed({ salarySelf: 300_000, otherOrdinary: 200_000 });
    expect(a.get("tentativeMinimumTax")).toBeLessThan(b.get("tentativeMinimumTax"));
  });
});

describe("equity income", () => {
  test("RSU vesting and NSO spread are ordinary income and count for Medicare", () => {
    const L = fed({ salarySelf: 190_000, rsuSharesVested: 1_000, rsuIncome: 30_000, nsoSharesExercised: 500, nsoIncome: 10_000 });
    expect(L.get("ordinaryIncome")).toBe(230_000);
    expect(L.get("agi")).toBe(230_000);
    expect(L.get("additionalMedicare")).toBeCloseTo(30_000 * 0.009);
    expect(L.get("amti")).toBe(L.get("taxableIncome") + L.get("standardDeduction"));
  });
});

describe("wages, losses, giving and the mortgage cap", () => {
  test("pre-tax contributions reduce box 1 but not Medicare wages", () => {
    const L = fed({ salarySelf: 300_000, pretaxContributions: 23_500 });
    expect(L.get("wages")).toBe(276_500);
    expect(L.get("additionalMedicare")).toBeCloseTo(100_000 * 0.009);
  });
  test("spouse salary is added and shown", () => {
    const L = fed({ filingStatus: "mfj", salarySelf: 300_000, salarySpouse: 150_000 });
    expect(L.get("wages")).toBe(450_000);
    expect(L.lines.salarySpouse).toBeDefined();
  });
  test("capital loss carryforward offsets gains, then $3,000 of ordinary income, then carries", () => {
    const L = fed({ salarySelf: 100_000, longTermGains: 10_000, capitalLossCarryIn: { shortTerm: 0, longTerm: 25_000 } });
    expect(L.get("netLongTermGain")).toBe(0);
    expect(L.get("capitalLossDeduction")).toBe(3_000);
    expect(L.get("capitalLossCarryOut")).toBe(12_000);
    expect(L.get("agi")).toBe(97_000);
  });
  test("charitable gifts respect AGI limits and carry forward", () => {
    const L = fed({ salarySelf: 100_000, charitableCash: 70_000, charitableStock: 40_000, mortgageInterestPaid: 1 });
    expect(L.get("charitableCarryOut")).toBeCloseTo(50_000); // 60k cash allowed, 0 stock (60% cap reached)
    expect(L.get("charitableDeduction")).toBeCloseTo(60_000 - 500);
  });
  test("mortgage interest over the cap is only partly deductible", () => {
    const L = fed({ salarySelf: 400_000, mortgageInterestPaid: 48_000, mortgageCapFraction: 0.75 });
    expect(L.get("mortgageInterest")).toBeCloseTo(36_000);
    expect(L.get("usesItemized")).toBe(1);
  });
});

describe("deduction choice under AMT", () => {
  test("itemizes when a smaller itemized total leaves less regular tax plus AMT", () => {
    // Big ISO exercise puts the filer in AMT; the standard deduction is disallowed there, so itemizing (SALT + mortgage) wins.
    const L = fed({ filingStatus: "mfj", salarySelf: 1_100_000, propertyTax: 21_000, mortgageInterestPaid: 12_950, isoBargainElement: 385_000 });
    expect(L.get("itemizedDeductions")).toBeLessThan(L.get("standardDeduction"));
    expect(L.get("usesItemized")).toBe(1);
    expect(L.lines.usesItemized!.why).toContain("disallowed under AMT");
  });
  test("still takes the larger standard deduction when there is no AMT", () => {
    const L = fed({ filingStatus: "mfj", salarySelf: 300_000, propertyTax: 5_000 });
    expect(L.get("usesItemized")).toBe(0);
  });
});

describe("rate shift", () => {
  test("a bracket rate delta raises every ordinary rate", () => {
    const L = fed({ salarySelf: 300_000, bracketRateDelta: 0.02 });
    const base = fed({ salarySelf: 300_000 });
    expect(L.get("ordinaryTax")).toBeCloseTo(base.get("ordinaryTax") + 0.02 * base.get("ordinaryTaxable"), 0);
    expect(L.get("marginalBracket")).toBeCloseTo(0.37);
  });
});

describe("indexing", () => {
  test("projected years scale published edges", () => {
    const p = federalParams(2028, 0.03);
    expect(p.published).toBe(false);
    expect(p.standardDeduction.single).toBeCloseTo(16_100 * 1.03 ** 2, -2);
    expect(p.salt.cap.single).toBe(Math.round(40_400 * 1.01 ** 2));
    expect(federalParams(2030, 0.03).salt.cap.single).toBe(10_000);
    expect(p.niit.threshold.single).toBe(200_000);
  });
});

describe("the 2026 limit on itemized deductions", () => {
  test("a 37%-bracket filer loses 2/37 of the lesser of the deductions or the income over the bracket's start, and AMT ignores the cut", () => {
    const L = fed({ salarySelf: 1_000_000, charitableCash: 100_000 });
    const itemized = L.get("itemizedDeductions"); // 100,000 less the 0.5% floor
    expect(itemized).toBeCloseTo(95_000, 0);
    const topStart = FEDERAL_2026.brackets.single[FEDERAL_2026.brackets.single.length - 2]!.upTo;
    const cut = (2 / 37) * Math.min(itemized, 1_000_000 - topStart);
    expect(L.get("itemizedAllowed")).toBeCloseTo(itemized - cut, 2);
    expect(L.get("deduction")).toBeCloseTo(itemized - cut, 2);
    expect(L.get("taxableIncome")).toBeCloseTo(1_000_000 - itemized + cut, 2);
    expect(L.get("amtAddbacks")).toBeCloseTo(cut, 2);
    expect(L.lines.itemizedAllowed!.why).toContain("2/37");
  });
  test("below the bracket's start, and before 2026, nothing is cut", () => {
    const low = fed({ salarySelf: 400_000, charitableCash: 50_000 });
    expect(low.get("itemizedAllowed")).toBeCloseTo(low.get("itemizedDeductions"), 6);
    const L25 = fed({ year: 2025, salarySelf: 1_000_000, charitableCash: 100_000 });
    expect(L25.get("itemizedAllowed")).toBeCloseTo(L25.get("itemizedDeductions"), 6);
  });
});

describe("the list of modeled rules", () => {
  test("is stated from the year's parameters and names every ledger-visible rule family", () => {
    const { modeledRules } = require("../src/rules.ts") as typeof import("../src/rules.ts");
    const groups = modeledRules(2026);
    const titles = groups.map((g) => g.title);
    expect(titles.some((t) => t.startsWith("Federal income tax, 2026"))).toBe(true);
    expect(titles).toContain("Not modeled yet");
    const all = groups.flatMap((g) => g.items);
    expect(all.find((i) => i.name === "Standard deduction")!.detail).toBe("$16,100 single, $32,200 joint.");
    expect(all.find((i) => i.name === "State and local taxes")!.detail).toContain("$40,400");
    expect(all.some((i) => i.name.startsWith("Top-bracket limit"))).toBe(true);
    expect(modeledRules(2025).flatMap((g) => g.items).some((i) => i.name.startsWith("Top-bracket limit"))).toBe(false);
    expect(all.filter((i) => i.name.includes("WA")).length).toBe(1);
    for (const i of all) { expect(i.name.length).toBeGreaterThan(2); expect(i.detail.endsWith(".")).toBe(true); }
  });
});

