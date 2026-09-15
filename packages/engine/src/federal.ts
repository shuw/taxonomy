import { netCapital } from "./capital.ts";
import { Ledger, pct, usd } from "./ledger.ts";
import { bracketRate, bracketTax, capGainsTax, type FederalParams } from "./params.ts";
import type { YearInputs } from "./types.ts";

const n = (x: number) => Math.round(x).toLocaleString("en-US");

/**
 * Federal income tax for one year: regular tax, AMT, the minimum tax credit, NIIT and the
 * additional Medicare tax. Every intermediate lands on the ledger with a reason.
 *
 * Simplifications (deliberate, so the model stays readable):
 *  - All of `longTermGains` is treated as eligible for preferential rates (no 25%/28% gain types).
 *  - AMT credit: all AMT caused by the ISO bargain element is treated as deferral (creditable);
 *    AMT caused by SALT/standard deduction addbacks is exclusion (not creditable).
 *  - Charitable limits: cash and DAF gifts up to 60% of AGI, appreciated stock up to 30%,
 *    excess carried forward; the 2026 35%-value cap for 37% bracket filers is not applied.
 *  - Mortgage interest under the acquisition-debt cap is fully deductible for AMT (assumed acquisition debt).
 *  - No credits other than the minimum tax credit; no QBI, no child tax credit yet.
 */
export function computeFederal(inputs: YearInputs, p: FederalParams, ledger: Ledger): void {
  const fs = inputs.filingStatus;
  const L = ledger;
  const hasSpouse = inputs.salarySpouse > 0;

  // Wages ------------------------------------------------------------------
  L.put("salarySelf", hasSpouse ? "Your salary and bonus" : "Salary and bonus", inputs.salarySelf, "Base pay plus bonus from the profile, grown by the wage growth assumption.");
  if (inputs.salarySpouse > 0) L.put("salarySpouse", "Spouse salary and bonus", inputs.salarySpouse, "Spouse base pay plus bonus, grown by the wage growth assumption.");
  L.put("rsuIncome", "RSU vesting income", inputs.rsuIncome, inputs.rsuSharesVested > 0 ? `${n(inputs.rsuSharesVested)} units vested x share value. Taxed as wages the year they vest, whether or not you sell.` : "No RSUs vest this year.");
  L.put("nsoIncome", "NSO exercise income", inputs.nsoIncome, inputs.nsoSharesExercised > 0 ? `(FMV - strike) x ${n(inputs.nsoSharesExercised)} NSO shares exercised. Unlike ISOs, the spread is ordinary wage income right away, and there is no AMT preference.` : "No NSO exercises this year.");
  L.put("pretaxContributions", "Pre-tax contributions", inputs.pretaxContributions, inputs.pretaxContributions > 0 ? "401(k), HSA and similar. They come out of taxable wages (W-2 box 1) but not Medicare wages." : "No pre-tax contributions in the profile.");
  const grossWages = inputs.salarySelf + inputs.salarySpouse + inputs.rsuIncome + inputs.nsoIncome;
  const wages = L.put(
    "wages", "Taxable wages (W-2 box 1)", Math.max(0, grossWages - inputs.pretaxContributions),
    "Salary and bonus + RSU vesting + NSO exercise spread - pre-tax contributions.",
    ["salarySelf", ...(inputs.salarySpouse > 0 ? ["salarySpouse"] : []), "rsuIncome", "nsoIncome", "pretaxContributions"],
  );

  // Investment income ------------------------------------------------------
  L.put("otherOrdinary", "Other ordinary income", inputs.otherOrdinary, "From the profile: K-1s, rental, side income.");
  L.put("interest", "Interest", inputs.interest, "From the profile. Taxed as ordinary income.");
  L.put("nonqualifiedDividends", "Non-qualified dividends", inputs.nonqualifiedDividends, "Total dividends minus the qualified part. Taxed as ordinary income.");
  L.put("qualifiedDividends", "Qualified dividends", inputs.qualifiedDividends, "From the profile. Taxed at long-term capital gain rates.");
  L.put("sharesSold", "Shares sold", inputs.sharesSold, inputs.sharesSold > 0 ? `Sold for ${usd(inputs.saleProceeds)}. Each lot's gain is its price less its basis; the character depends on how long it was held.` : "No shares sold this year.", [], "shares");
  L.put("isoDisqualifyingIncome", "ISO disqualifying disposition income", inputs.isoDisqualifyingIncome, inputs.isoDisqualifyingIncome > 0 ? "ISO shares sold within a year of exercise or two of grant: the spread at exercise (limited to the actual gain) is ordinary income, not capital gain. It is not subject to Medicare tax." : "No ISO shares sold before their holding periods.", ["sharesSold"]);
  L.put("longTermGains", "Long-term capital gains", inputs.longTermGains, inputs.sharesSold > 0 ? "Gains in the profile plus this year's sales of shares held over a year." : "From the profile. Gains on assets held over a year.", ["sharesSold"]);
  L.put("shortTermGains", "Short-term capital gains", inputs.shortTermGains, inputs.sharesSold > 0 ? "Gains in the profile plus this year's sales of shares held a year or less. Taxed as ordinary income." : "From the profile. Taxed as ordinary income.", ["sharesSold"]);
  const carryInTotal = inputs.capitalLossCarryIn.shortTerm + inputs.capitalLossCarryIn.longTerm;
  L.put("capitalLossCarryIn", "Capital loss carried in", carryInTotal, carryInTotal > 0 ? `${usd(inputs.capitalLossCarryIn.shortTerm)} short-term and ${usd(inputs.capitalLossCarryIn.longTerm)} long-term losses from earlier years, netted against this year's gains first.` : "No capital loss carryforward.");
  const cap = netCapital(inputs.shortTermGains, inputs.longTermGains, inputs.capitalLossCarryIn, fs === "mfs" ? 1_500 : 3_000);
  L.put("netShortTermGain", "Net short-term gain", cap.ordinaryGain, "Short-term gains after losses and carryforwards. Ordinary income.", ["shortTermGains", "capitalLossCarryIn"]);
  L.put("netLongTermGain", "Net long-term gain", cap.preferentialGain, "Long-term gains after losses and carryforwards. Preferential rates.", ["longTermGains", "capitalLossCarryIn"]);
  L.put("capitalLossDeduction", "Capital loss deduction", cap.lossDeduction, cap.lossDeduction > 0 ? `Net capital loss offsets up to ${usd(fs === "mfs" ? 1_500 : 3_000)} of ordinary income; the rest carries forward.` : "No net capital loss this year.", ["shortTermGains", "longTermGains", "capitalLossCarryIn"]);
  L.put("capitalLossCarryOutShortTerm", "Short-term loss carried forward", cap.carryOut.shortTerm, "Unused short-term loss for next year.", ["capitalLossDeduction"]);
  L.put("capitalLossCarryOutLongTerm", "Long-term loss carried forward", cap.carryOut.longTerm, "Unused long-term loss for next year.", ["capitalLossDeduction"]);
  L.put("capitalLossCarryOut", "Capital loss carried forward", cap.carryOut.shortTerm + cap.carryOut.longTerm, "Short-term + long-term loss still unused after this year.", ["capitalLossCarryOutShortTerm", "capitalLossCarryOutLongTerm"]);

  const ordinaryIncome = L.put(
    "ordinaryIncome", "Ordinary income",
    wages + inputs.otherOrdinary + inputs.interest + inputs.nonqualifiedDividends + cap.ordinaryGain - cap.lossDeduction + inputs.isoDisqualifyingIncome,
    "Taxable wages + other ordinary income + interest + non-qualified dividends + net short-term gains - capital loss deduction" + (inputs.isoDisqualifyingIncome > 0 ? " + ISO disqualifying disposition income" : "") + ". Taxed on the bracket schedule.",
    ["wages", "otherOrdinary", "interest", "nonqualifiedDividends", "netShortTermGain", "capitalLossDeduction", ...(inputs.isoDisqualifyingIncome > 0 ? ["isoDisqualifyingIncome"] : [])],
  );
  const preferentialGross = inputs.qualifiedDividends + cap.preferentialGain;
  const agi = L.put(
    "agi", "Adjusted gross income",
    ordinaryIncome + preferentialGross,
    "Ordinary income + qualified dividends + net long-term gains. Exercising ISOs does not change AGI; the bargain element only appears in the AMT calculation.",
    ["ordinaryIncome", "qualifiedDividends", "netLongTermGain"],
  );

  // Deductions ----------------------------------------------------------------
  const saltPaid = inputs.propertyTax + inputs.stateIncomeTax;
  const saltExcess = Math.max(0, agi - p.salt.phaseoutStart[fs]);
  const saltCap = Math.max(p.salt.floor[fs], p.salt.cap[fs] - p.salt.phaseoutRate * saltExcess);
  L.put(
    "saltCap", "SALT cap", saltCap,
    saltExcess > 0
      ? `The ${usd(p.salt.cap[fs])} cap shrinks by 30% of AGI over ${usd(p.salt.phaseoutStart[fs])} (${usd(saltExcess)} over), but never below ${usd(p.salt.floor[fs])}.`
      : p.year >= 2030
        ? `The SALT cap reverts to ${usd(saltCap)} in 2030 under current law.`
        : `${usd(saltCap)} cap for ${p.year}. It phases down for AGI over ${usd(p.salt.phaseoutStart[fs])}.`,
    ["agi"],
  );
  const saltDeduction = L.put(
    "saltDeduction", "State and local tax deduction", Math.min(saltPaid, saltCap),
    saltPaid > saltCap ? `You paid ${usd(saltPaid)} in property and state income tax, limited to the ${usd(saltCap)} cap.` : `Property tax + state income tax paid (${usd(saltPaid)}), under the ${usd(saltCap)} cap.`,
    ["saltCap"],
  );
  L.put("mortgageInterestPaid", "Mortgage interest paid", inputs.mortgageInterestPaid, inputs.mortgageInterestPaid > 0 ? "Interest for the year from the loan's amortization, or the figure in the profile." : "No mortgage interest.");
  const mortgageDeduction = L.put(
    "mortgageInterest", "Mortgage interest deduction", inputs.mortgageInterestPaid * inputs.mortgageCapFraction,
    inputs.mortgageCapFraction < 1
      ? `Only interest on the first $750,000 of acquisition debt is deductible: ${pct(inputs.mortgageCapFraction)} of what you paid. Deductible for both regular tax and AMT.`
      : "Interest on acquisition debt under the cap. Deductible for both regular tax and AMT.",
    ["mortgageInterestPaid"],
  );
  const cashGifts = inputs.charitableCash + inputs.charitableCarryIn;
  const cashAllowed = Math.min(cashGifts, 0.6 * agi);
  const stockAllowed = Math.min(inputs.charitableStock, 0.3 * agi, Math.max(0, 0.6 * agi - cashAllowed));
  const contributions = cashAllowed + stockAllowed;
  const charitableCarryOut = cashGifts + inputs.charitableStock - contributions;
  const charitableFloor = p.charitableAgiFloor * agi;
  const charitableDeduction = L.put(
    "charitableDeduction", "Charitable deduction", Math.max(0, contributions - charitableFloor),
    contributions > 0
      ? `Cash and DAF gifts (${usd(cashGifts)}, up to 60% of AGI) plus appreciated stock (${usd(inputs.charitableStock)}, up to 30%)` +
        (charitableCarryOut > 0 ? `; ${usd(charitableCarryOut)} over the limits carries forward` : "") +
        (charitableFloor > 0 ? `, less the 0.5%-of-AGI floor (${usd(charitableFloor)}) that applies to itemizers from 2026.` : ".")
      : "No charitable giving in the profile.",
    ["agi"],
  );
  L.put("charitableCarryOut", "Charitable carried forward", charitableCarryOut, "Gifts over the AGI limits, deductible in the next five years.", ["charitableDeduction"]);
  const medicalDeduction = L.put("medicalDeduction", "Medical deduction", Math.max(0, inputs.medical - 0.075 * agi), inputs.medical > 0 ? "Medical expenses over 7.5% of AGI." : "No medical expenses in the profile.", ["agi"]);
  const itemized = L.put(
    "itemizedDeductions", "Itemized deductions", saltDeduction + mortgageDeduction + charitableDeduction + medicalDeduction,
    "SALT (capped) + mortgage interest + charitable + medical.", ["saltDeduction", "mortgageInterest", "charitableDeduction", "medicalDeduction"],
  );
  const standard = L.put("standardDeduction", "Standard deduction", p.standardDeduction[fs], `${p.year} standard deduction for ${statusName(fs)} filers${p.published ? "" : " (projected)"}.`);

  // Which deduction to take is decided on regular tax plus AMT together: the standard deduction is
  // disallowed under AMT, so a smaller itemized total can still leave less tax to pay overall.
  const brackets = p.brackets[fs];
  const cg = p.capGains[fs];
  /** Tentative minimum tax from taxable income plus the AMT-only items. Shared by the deduction choice and the AMT lines below. */
  const minimumTax = (taxable: number, addback: number, bargain: number, adjustment: number) => {
    const amti = Math.max(0, taxable + addback + bargain + adjustment);
    const phaseoutExcess = Math.max(0, amti - p.amt.phaseoutStart[fs]);
    const exemption = Math.max(0, p.amt.exemption[fs] - p.amt.phaseoutRate * phaseoutExcess);
    const base = Math.max(0, amti - exemption);
    const pref = Math.min(base, preferentialGross);
    const ordinaryPart = base - pref;
    const rb = p.amt.rateBreak[fs];
    const tmt = Math.min(ordinaryPart, rb) * p.amt.lowRate + Math.max(0, ordinaryPart - rb) * p.amt.highRate + capGainsTax(pref, ordinaryPart, cg);
    return { amti, phaseoutExcess, exemption, base, ordinaryPart, tmt };
  };
  const taxUnder = (deductionAmount: number, addback: number) => {
    const taxable = Math.max(0, agi - deductionAmount);
    const pref = Math.min(taxable, preferentialGross);
    const ordinary = taxable - pref;
    const regular = bracketTax(ordinary, brackets) + capGainsTax(pref, ordinary, cg);
    const { tmt } = minimumTax(taxable, addback, inputs.isoBargainElement, inputs.amtCapitalAdjustment);
    return regular + Math.max(0, tmt - regular);
  };
  const withItemized = taxUnder(itemized, saltDeduction);
  const withStandard = taxUnder(standard, standard);
  const usesItemized = itemized > standard ? withItemized <= withStandard : withItemized < withStandard;
  L.put(
    "usesItemized", "Itemizing?", usesItemized ? 1 : 0,
    usesItemized
      ? itemized > standard
        ? `Itemized (${usd(itemized)}) beats standard (${usd(standard)}).`
        : `Itemized (${usd(itemized)}) is smaller than standard (${usd(standard)}), but the standard deduction is disallowed under AMT, so itemizing leaves ${usd(withStandard - withItemized)} less tax overall.`
      : itemized > standard
        ? `Itemized (${usd(itemized)}) is larger, but taking it would raise regular tax plus AMT by ${usd(withItemized - withStandard)}; standard wins.`
        : `Standard (${usd(standard)}) beats itemized (${usd(itemized)}).`,
    ["itemizedDeductions", "standardDeduction"], "flag",
  );
  const deduction = L.put("deduction", "Deduction taken", usesItemized ? itemized : standard, usesItemized ? "Itemized deductions." : "The standard deduction.", ["usesItemized"]);

  const taxableIncome = L.put("taxableIncome", "Taxable income", Math.max(0, agi - deduction), "AGI minus the deduction taken.", ["agi", "deduction"]);
  const preferential = Math.min(taxableIncome, preferentialGross);
  const ordinaryTaxable = taxableIncome - preferential;
  L.put("ordinaryTaxable", "Ordinary taxable income", ordinaryTaxable, "Taxable income excluding the part taxed at capital gain rates. The deduction is applied to ordinary income first, which is what the IRS worksheet does.", ["taxableIncome"]);
  L.put("preferentialIncome", "Income at capital gain rates", preferential, "Qualified dividends + net long-term gains, stacked on top of ordinary income.", ["taxableIncome"]);

  // Regular tax ---------------------------------------------------------------
  const marginal = bracketRate(ordinaryTaxable, brackets);
  const bracketEdge = brackets.find((b) => ordinaryTaxable <= b.upTo)?.upTo ?? Infinity;
  const ordinaryTax = L.put(
    "ordinaryTax", "Tax on ordinary income", bracketTax(ordinaryTaxable, brackets),
    `Bracket schedule applied to ${usd(ordinaryTaxable)}. Top dollar is in the ${pct(marginal)} bracket` +
      (Number.isFinite(bracketEdge) ? `, ${usd(bracketEdge - ordinaryTaxable)} below the ${pct(bracketRate(bracketEdge + 1, brackets))} edge.` : "."),
    ["ordinaryTaxable"],
  );
  L.put("marginalBracket", "Ordinary marginal bracket", marginal, "Rate on the next dollar of ordinary income under regular tax.", ["ordinaryTaxable"], "rate");
  const capGainsTaxAmt = L.put(
    "capGainsTax", "Tax on capital gains and dividends", capGainsTax(preferential, ordinaryTaxable, cg),
    preferential > 0
      ? `0% up to ${usd(cg.zeroUpTo)} of taxable income, 15% to ${usd(cg.fifteenUpTo)}, 20% above; your gains sit on top of ${usd(ordinaryTaxable)} of ordinary income.`
      : "No income at preferential rates.",
    ["preferentialIncome", "ordinaryTaxable"],
  );
  const regularTax = L.put("regularTax", "Regular income tax", ordinaryTax + capGainsTaxAmt, "Tax on ordinary income + tax on capital gains, before AMT and credits.", ["ordinaryTax", "capGainsTax"]);

  // AMT -----------------------------------------------------------------------
  const addback = usesItemized ? saltDeduction : standard;
  L.put("amtAddbacks", "AMT addbacks", addback, usesItemized ? "The SALT deduction is not allowed under AMT, so it is added back. Mortgage interest and charitable gifts stay deductible." : "The standard deduction is not allowed under AMT, so it is added back.", ["usesItemized"]);
  L.put("isoSharesExercised", "ISO shares exercised", inputs.isoSharesExercised, "The lever. Vested ISO shares exercised this year, drawn from ISO grants in profile order.", [], "shares");
  L.put(
    "isoBargainElement", "ISO bargain element", inputs.isoBargainElement,
    inputs.isoSharesExercised > 0 || inputs.isoBargainElement > 0
      ? `(FMV - strike) x shares exercised. It is income for AMT the year you exercise, even though you sold nothing and it is invisible to regular tax.`
      : "No ISO exercises this year, so no AMT preference from equity.",
    ["isoSharesExercised"],
  );

  L.put(
    "amtCapitalAdjustment", "AMT basis adjustment on shares sold", inputs.amtCapitalAdjustment,
    inputs.amtCapitalAdjustment !== 0
      ? "ISO shares carry a higher AMT basis (the value at exercise), so the AMT gain on selling them is smaller than the regular gain. This negative adjustment lowers AMTI and frees AMT credit."
      : "No ISO shares sold this year.",
    ["sharesSold"],
  );
  const amtOf = (bargain: number, adjustment = inputs.amtCapitalAdjustment) => minimumTax(taxableIncome, addback, bargain, adjustment);
  const a = amtOf(inputs.isoBargainElement);
  L.put("amti", "Alternative minimum taxable income", a.amti, "Taxable income + addbacks + ISO bargain element" + (inputs.amtCapitalAdjustment !== 0 ? " + the basis adjustment on ISO shares sold" : "") + ".", ["taxableIncome", "amtAddbacks", "isoBargainElement", ...(inputs.amtCapitalAdjustment !== 0 ? ["amtCapitalAdjustment"] : [])]);
  L.put(
    "amtExemption", "AMT exemption", a.exemption,
    a.phaseoutExcess > 0
      ? `The ${usd(p.amt.exemption[fs])} exemption shrinks by ${pct(p.amt.phaseoutRate)} of AMTI over ${usd(p.amt.phaseoutStart[fs])} (${usd(a.phaseoutExcess)} over)${a.exemption === 0 ? " and is fully gone" : ""}.`
      : `Full ${usd(p.amt.exemption[fs])} exemption; it starts phasing out at ${usd(p.amt.phaseoutStart[fs])} of AMTI, ${usd(p.amt.phaseoutStart[fs] - a.amti)} away.`,
    ["amti"],
  );
  const tmt = L.put(
    "tentativeMinimumTax", "Tentative minimum tax", a.tmt,
    `${pct(p.amt.lowRate)} on the first ${usd(p.amt.rateBreak[fs])} of AMTI above the exemption, ${pct(p.amt.highRate)} beyond; capital gains keep their preferential rates.`,
    ["amti", "amtExemption"],
  );
  const amt = L.put(
    "amt", "Alternative minimum tax", Math.max(0, tmt - regularTax),
    tmt > regularTax
      ? `Tentative minimum tax (${usd(tmt)}) exceeds regular tax (${usd(regularTax)}); you owe the difference on top.`
      : `Regular tax (${usd(regularTax)}) exceeds tentative minimum tax (${usd(tmt)}) by ${usd(regularTax - tmt)}; no AMT owed. That gap is also the room for using AMT credit.`,
    ["tentativeMinimumTax", "regularTax"],
  );

  // AMT credit -----------------------------------------------------------------
  const exclusionOnlyAmt = Math.max(0, amtOf(0, 0).tmt - regularTax);
  const creditGenerated = L.put(
    "amtCreditGenerated", "AMT credit generated", Math.max(0, amt - exclusionOnlyAmt),
    amt > 0
      ? `AMT caused by the ISO bargain element (a timing difference) becomes a credit against future regular tax. ${exclusionOnlyAmt > 0 ? `${usd(exclusionOnlyAmt)} of this year's AMT comes from the SALT/standard deduction addback and is not creditable.` : ""}`
      : "No AMT this year, so no new credit.",
    ["amt"],
  );
  L.put("amtCreditCarryforwardIn", "AMT credit carried in", inputs.amtCreditCarryforwardIn, "Unused minimum tax credit from earlier years (Form 8801).");
  const creditRoom = Math.max(0, regularTax - tmt);
  const creditUsed = L.put(
    "amtCreditUsed", "AMT credit used", Math.min(inputs.amtCreditCarryforwardIn, creditRoom),
    inputs.amtCreditCarryforwardIn === 0
      ? "No credit available to use."
      : creditRoom === 0
        ? "Credit can only offset regular tax above tentative minimum tax; this year there is no such room."
        : `Credit offsets regular tax only down to tentative minimum tax: room of ${usd(creditRoom)}, credit available ${usd(inputs.amtCreditCarryforwardIn)}.`,
    ["amtCreditCarryforwardIn", "regularTax", "tentativeMinimumTax"],
  );
  L.put("amtCreditCarryforwardOut", "AMT credit carried forward", inputs.amtCreditCarryforwardIn + creditGenerated - creditUsed, "Carried in + generated this year - used this year. Carries forward indefinitely.", ["amtCreditCarryforwardIn", "amtCreditGenerated", "amtCreditUsed"]);

  const federalIncomeTax = L.put("federalIncomeTax", "Federal income tax", regularTax + amt - creditUsed, "Regular tax + AMT - AMT credit used.", ["regularTax", "amt", "amtCreditUsed"]);

  // Surtaxes ---------------------------------------------------------------------
  const nii = inputs.interest + inputs.nonqualifiedDividends + inputs.qualifiedDividends + Math.max(0, cap.ordinaryGain + cap.preferentialGain);
  const niitBase = Math.min(nii, Math.max(0, agi - p.niit.threshold[fs]));
  L.put(
    "niit", "Net investment income tax", niitBase * p.niit.rate,
    niitBase > 0
      ? `3.8% of the lesser of net investment income (${usd(nii)}) and AGI over ${usd(p.niit.threshold[fs])} (${usd(agi - p.niit.threshold[fs])}). The threshold is not indexed for inflation.`
      : agi > p.niit.threshold[fs] ? "AGI is over the threshold but there is no investment income." : `AGI is under the ${usd(p.niit.threshold[fs])} threshold.`,
    ["agi", "interest", "nonqualifiedDividends", "qualifiedDividends", "netLongTermGain", "netShortTermGain"],
  );
  const medicareBase = Math.max(0, (inputs.medicareWages ?? grossWages) - p.additionalMedicare.threshold[fs]);
  L.put("additionalMedicare", "Additional Medicare tax", medicareBase * p.additionalMedicare.rate, medicareBase > 0 ? `0.9% of Medicare wages (salary, bonus, RSU and NSO income, before pre-tax contributions) over ${usd(p.additionalMedicare.threshold[fs])}.` : `Medicare wages are under the ${usd(p.additionalMedicare.threshold[fs])} threshold.`, ["salarySelf", "rsuIncome", "nsoIncome"]);

  L.put("federalTotal", "Total federal tax", federalIncomeTax + L.get("niit") + L.get("additionalMedicare"), "Federal income tax + NIIT + additional Medicare tax (1040 line 24).", ["federalIncomeTax", "niit", "additionalMedicare"]);
}

export function statusName(fs: YearInputs["filingStatus"]): string {
  return { single: "single", mfj: "married filing jointly", mfs: "married filing separately", hoh: "head of household" }[fs];
}
