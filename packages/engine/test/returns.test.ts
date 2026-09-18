import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile } from "../src/profile.ts";
import { calibrate } from "../src/calibration.ts";
import type { PriorReturn } from "../src/types.ts";

/**
 * Three made-up 2025 returns, worked by hand from the IRS figures for that year (Rev. Proc.
 * 2024-40 brackets, the 2025 standard deduction, Form 6251, Form 8801, Form 8960, Form 8959)
 * with the arithmetic written out, then run through the calibration the app uses on a real
 * return. Every compared line must match to the dollar. Nothing here comes from the engine.
 */
const example = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");
const withReturn = (pr: PriorReturn) => ({ ...parseProfile(example), returns: [pr] });
const rows = (pr: PriorReturn) => Object.fromEntries(calibrate(withReturn(pr))!.rows.map((r) => [r.id, r]));

// 2025 single brackets: 10% to 11,925; 12% to 48,475; 22% to 103,350; 24% to 197,300; 32% to 250,525; 35% to 626,350; 37% above.
const SINGLE_TAX_TO_250_525 = 11_925 * 0.10 + (48_475 - 11_925) * 0.12 + (103_350 - 48_475) * 0.22 + (197_300 - 103_350) * 0.24 + (250_525 - 197_300) * 0.32; // 57,231
// 2025 joint brackets: 10% to 23,850; 12% to 96,950; 22% to 206,700; 24% to 394,600; 32% to 501,050; 35% to 751,600; 37% above.
const JOINT_TAX_TO_751_600 = 23_850 * 0.10 + (96_950 - 23_850) * 0.12 + (206_700 - 96_950) * 0.22 + (394_600 - 206_700) * 0.24 + (501_050 - 394_600) * 0.32 + (751_600 - 501_050) * 0.35; // 202,154.50

describe("made-up 2025 returns worked by hand", () => {
  test("A: single, wages, interest and qualified dividends, standard deduction", () => {
    // AGI 310,500; taxable 294,750 after the 15,750 standard deduction; 4,000 of it is qualified dividends at 15%.
    const ordinaryTaxable = 294_750 - 4_000;
    const regularTax = SINGLE_TAX_TO_250_525 + (ordinaryTaxable - 250_525) * 0.35 + 4_000 * 0.15; // 71,309.75 + 600
    expect(regularTax).toBeCloseTo(71_909.75, 2);
    // AMT: AMTI 310,500 (the standard deduction comes back), exemption 88,100 in full, 26% on the ordinary part, dividends keep 15%.
    const tmt = (310_500 - 88_100 - 4_000) * 0.26 + 4_000 * 0.15; // 57,384
    expect(tmt).toBeLessThan(regularTax);
    const pr: PriorReturn = {
      year: 2025, filingStatus: "single",
      inputs: { wages: 300_000, medicareWages: 300_000, interest: 6_000, ordinaryDividends: 4_500, qualifiedDividends: 4_000 },
      reported: { agi: 310_500, taxableIncome: 294_750, regularTax, amti: 310_500, amtExemption: 88_100, tentativeMinimumTax: tmt, amt: 0, niit: 10_500 * 0.038, additionalMedicare: (300_000 - 200_000) * 0.009, totalTax: regularTax + 399 + 900 },
    };
    const r = rows(pr);
    for (const id of Object.keys(r)) expect(Math.abs(r[id]!.delta), `${id}: reported ${r[id]!.reported}, computed ${r[id]!.computed}`).toBeLessThanOrEqual(1);
    expect(Object.keys(r).sort()).toEqual(["additionalMedicare", "agi", "amt", "amtExemption", "amti", "federalTotal", "niit", "regularTax", "taxableIncome", "tentativeMinimumTax"]);
  });

  test("B: joint, itemized under the SALT phase-down, an ISO exercise that trips AMT with the exemption phasing out", () => {
    // AGI 912,000. SALT paid 60,000: the 40,000 cap shrinks by 30% of AGI over 500,000 (123,600), to the 10,000 floor.
    // Itemized 10,000 + 20,000 mortgage + 50,000 charity = 80,000 > 31,500 standard. Taxable 832,000. No 2/37 limit in 2025.
    const regularTax = JOINT_TAX_TO_751_600 + (832_000 - 751_600) * 0.37; // 231,902.50
    expect(regularTax).toBeCloseTo(231_902.5, 2);
    // Form 6251: AMTI = 832,000 + 10,000 SALT addback + 600,000 bargain element = 1,442,000. Exemption 137,000 less 25% of the
    // 189,300 over 1,252,700 = 89,675. Base 1,352,325: 26% to 239,100, 28% above.
    const exemption = 137_000 - 0.25 * (1_442_000 - 1_252_700);
    expect(exemption).toBe(89_675);
    const tmt = 239_100 * 0.26 + (1_442_000 - exemption - 239_100) * 0.28; // 373,869
    const amt = tmt - regularTax; // 141,966.50
    const pr: PriorReturn = {
      year: 2025, filingStatus: "mfj",
      inputs: { wages: 900_000, medicareWages: 900_000, interest: 12_000, itemized: { salt: 60_000, mortgageInterest: 20_000, charitable: 50_000 }, isoBargainElement: 600_000 },
      reported: { agi: 912_000, taxableIncome: 832_000, regularTax, amti: 1_442_000, amtExemption: exemption, tentativeMinimumTax: tmt, amt, niit: 12_000 * 0.038, additionalMedicare: (900_000 - 250_000) * 0.009, totalTax: regularTax + amt + 456 + 5_850 },
    };
    const r = rows(pr);
    for (const id of Object.keys(r)) expect(Math.abs(r[id]!.delta), `${id}: reported ${r[id]!.reported}, computed ${r[id]!.computed}`).toBeLessThanOrEqual(1);
    expect(r.amt!.computed).toBeCloseTo(141_966.5, 0);
  });

  test("C: single, long-term gains stacked at 15%, a short-term loss netted, and an AMT credit carried in and partly used", () => {
    // Wages 150,000, long-term gains 120,000, short-term loss 8,000: net gain 112,000, all long-term. AGI 262,000; taxable 246,250.
    const ordinaryTaxable = 246_250 - 112_000; // 134,250
    const ordinaryTax = 11_925 * 0.10 + (48_475 - 11_925) * 0.12 + (103_350 - 48_475) * 0.22 + (ordinaryTaxable - 103_350) * 0.24; // 25,067
    const regularTax = ordinaryTax + 112_000 * 0.15; // the 0% band (to 48,350) is already used up by ordinary income
    expect(regularTax).toBeCloseTo(41_867, 2);
    // AMT: AMTI 262,000, exemption 88,100; ordinary part 61,900 at 26%, the gain keeps 15%. Credit: regular tax over TMT, from the 30,000 carried in.
    const tmt = (262_000 - 88_100 - 112_000) * 0.26 + 112_000 * 0.15; // 32,894
    const creditUsed = Math.min(30_000, regularTax - tmt); // 8,973
    const pr: PriorReturn = {
      year: 2025, filingStatus: "single",
      inputs: { wages: 150_000, medicareWages: 150_000, longTermGains: 120_000, shortTermGains: -8_000, amtCreditCarriedIn: 30_000 },
      reported: { agi: 262_000, taxableIncome: 246_250, regularTax, amti: 262_000, amtExemption: 88_100, tentativeMinimumTax: tmt, amt: 0, amtCreditUsed: creditUsed, niit: (262_000 - 200_000) * 0.038, additionalMedicare: 0, totalTax: regularTax - creditUsed + (262_000 - 200_000) * 0.038 },
    };
    const r = rows(pr);
    for (const id of Object.keys(r)) expect(Math.abs(r[id]!.delta), `${id}: reported ${r[id]!.reported}, computed ${r[id]!.computed}`).toBeLessThanOrEqual(1);
    expect(r.amtCreditUsed!.computed).toBeCloseTo(8_973, 0);
  });
});
