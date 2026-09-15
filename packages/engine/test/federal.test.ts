import { describe, expect, test } from "bun:test";
import { Ledger } from "../src/ledger.ts";
import { computeFederal } from "../src/federal.ts";
import { FEDERAL_2026, bracketTax, capGainsTax, federalParams } from "../src/params.ts";
import type { YearInputs } from "../src/types.ts";

const base: YearInputs = {
  year: 2026, filingStatus: "single", state: "WA",
  salarySelf: 0, salarySpouse: 0, pretaxContributions: 0, otherOrdinary: 0, interest: 0, nonqualifiedDividends: 0, qualifiedDividends: 0, longTermGains: 0, shortTermGains: 0,
  capitalLossCarryIn: { shortTerm: 0, longTerm: 0 },
  mortgageInterestPaid: 0, mortgageCapFraction: 1, propertyTax: 0, stateIncomeTax: 0, charitableCash: 0, charitableStock: 0, charitableCarryIn: 0, medical: 0,
  isoSharesExercised: 0, isoBargainElement: 0, nsoSharesExercised: 0, nsoIncome: 0, rsuSharesVested: 0, rsuIncome: 0, sharesSold: 0, saleProceeds: 0, isoDisqualifyingIncome: 0, amtCapitalAdjustment: 0, amtCreditCarryforwardIn: 0, bracketRateDelta: 0,
};

function fed(over: Partial<YearInputs>) {
  const ledger = new Ledger();
  computeFederal({ ...base, ...over }, federalParams(over.year ?? 2026, 0.025, over.bracketRateDelta ?? 0), ledger);
  return ledger;
}

describe("bracket math", () => {
  test("bracket tax accumulates slices", () => {
    expect(bracketTax(12_400, FEDERAL_2026.brackets.single)).toBeCloseTo(1_240);
    expect(bracketTax(50_400, FEDERAL_2026.brackets.single)).toBeCloseTo(1_240 + 38_000 * 0.12);
  });
  test("capital gains stack on ordinary income", () => {
    const edges = FEDERAL_2026.capGains.single;
    expect(capGainsTax(10_000, 0, edges)).toBe(0);
    expect(capGainsTax(10_000, 100_000, edges)).toBeCloseTo(1_500);
    expect(capGainsTax(10_000, 600_000, edges)).toBeCloseTo(2_000);
    expect(capGainsTax(20_000, 40_000, edges)).toBeCloseTo((60_000 - 49_450) * 0.15);
  });
});

describe("regular tax", () => {
  test("wages only, standard deduction", () => {
    const L = fed({ salarySelf: 100_000 });
    expect(L.get("taxableIncome")).toBe(100_000 - 16_100);
    expect(L.get("regularTax")).toBeCloseTo(bracketTax(83_900, FEDERAL_2026.brackets.single));
    expect(L.get("amt")).toBe(0);
    expect(L.get("niit")).toBe(0);
  });
  test("SALT is capped and itemizing wins when it should", () => {
    const L = fed({ salarySelf: 200_000, propertyTax: 30_000, mortgageInterestPaid: 20_000 });
    expect(L.get("saltDeduction")).toBe(30_000);
    expect(L.get("usesItemized")).toBe(1);
    const L2 = fed({ salarySelf: 200_000, propertyTax: 50_000 });
    expect(L2.get("saltDeduction")).toBe(40_400);
  });
  test("SALT cap phases down above $505k but not below $10k", () => {
    expect(fed({ salarySelf: 600_000, propertyTax: 50_000 }).get("saltCap")).toBeCloseTo(40_400 - 0.3 * 95_000);
    expect(fed({ salarySelf: 2_000_000, propertyTax: 50_000 }).get("saltCap")).toBe(10_000);
  });
  test("NIIT applies to investment income above the threshold", () => {
    const L = fed({ salarySelf: 250_000, interest: 20_000 });
    expect(L.get("niit")).toBeCloseTo(20_000 * 0.038);
    const L2 = fed({ salarySelf: 190_000, interest: 20_000 });
    expect(L2.get("niit")).toBeCloseTo(10_000 * 0.038);
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
