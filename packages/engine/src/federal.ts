import { Ledger, pct, usd } from "./ledger.ts";
import { bracketRate, bracketTax, capGainsTax, type FederalParams } from "./params.ts";
import type { YearInputs } from "./types.ts";

/**
 * Federal income tax for one year: regular tax, AMT, the minimum tax credit, NIIT and the
 * additional Medicare tax. Every intermediate lands on the ledger with a reason.
 *
 * Simplifications (deliberate, so the model stays readable):
 *  - Net capital losses offset up to $3,000 of ordinary income; no loss carryforward.
 *  - All of `longTermGains` is treated as eligible for preferential rates (no 25%/28% gain types).
 *  - AMT credit: all AMT caused by the ISO bargain element is treated as deferral (creditable);
 *    AMT caused by SALT/standard deduction addbacks is exclusion (not creditable).
 *  - Mortgage interest is taken as given (the $750k acquisition-debt limit is not applied here).
 *  - No credits other than the minimum tax credit; no QBI, no phaseouts of itemized deductions.
 */
export function computeFederal(inputs: YearInputs, p: FederalParams, ledger: Ledger): void {
  const fs = inputs.filingStatus;
  const L = ledger;

  // Income ------------------------------------------------------------------
  L.put("wages", "Wages", inputs.wages, "From the profile, grown by the wage growth assumption.");
  L.put("otherOrdinary", "Other ordinary income", inputs.otherOrdinary, "From the profile.");
  L.put("interest", "Interest", inputs.interest, "From the profile. Taxed as ordinary income.");
  L.put("qualifiedDividends", "Qualified dividends", inputs.qualifiedDividends, "From the profile. Taxed at long-term capital gain rates.");
  L.put("longTermGains", "Long-term capital gains", inputs.longTermGains, "From the profile. Gains on assets held over a year.");
  L.put("shortTermGains", "Short-term capital gains", inputs.shortTermGains, "From the profile. Taxed as ordinary income.");

  const netGains = inputs.longTermGains + inputs.shortTermGains;
  const netLoss = netGains < 0 ? Math.min(3_000, -netGains) : 0;
  const ltcgTaxable = Math.max(0, netGains < 0 ? 0 : Math.min(inputs.longTermGains, netGains));
  const stcgTaxable = netGains < 0 ? -netLoss : Math.max(0, netGains - ltcgTaxable);

  const ordinaryIncome = L.put(
    "ordinaryIncome", "Ordinary income",
    inputs.wages + inputs.otherOrdinary + inputs.interest + stcgTaxable,
    `Wages + other ordinary income + interest + short-term gains${netLoss ? ` (net capital loss limited to $3,000)` : ""}. Taxed on the bracket schedule.`,
    ["wages", "otherOrdinary", "interest", "shortTermGains"],
  );
  const preferentialGross = inputs.qualifiedDividends + ltcgTaxable;
  const agi = L.put(
    "agi", "Adjusted gross income",
    ordinaryIncome + preferentialGross,
    "Ordinary income + qualified dividends + net long-term gains. Note: exercising ISOs does not change AGI; the bargain element only appears in the AMT calculation.",
    ["ordinaryIncome", "qualifiedDividends", "longTermGains"],
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
  L.put("mortgageInterest", "Mortgage interest deduction", inputs.mortgageInterest, "From the profile. Deductible for both regular tax and AMT.");
  const charitableFloor = p.charitableAgiFloor * agi;
  const charitableDeduction = L.put(
    "charitableDeduction", "Charitable deduction", Math.max(0, inputs.charitable - charitableFloor),
    inputs.charitable > 0
      ? `Gifts of ${usd(inputs.charitable)} less the 0.5%-of-AGI floor (${usd(charitableFloor)}) that applies to itemizers from 2026.`
      : "No charitable giving in the profile.",
    ["agi"],
  );
  const itemized = L.put(
    "itemizedDeductions", "Itemized deductions", saltDeduction + inputs.mortgageInterest + charitableDeduction,
    "SALT (capped) + mortgage interest + charitable.", ["saltDeduction", "mortgageInterest", "charitableDeduction"],
  );
  const standard = L.put("standardDeduction", "Standard deduction", p.standardDeduction[fs], `${p.year} standard deduction for ${statusName(fs)} filers${p.published ? "" : " (projected)"}.`);
  const usesItemized = itemized > standard;
  L.put("usesItemized", "Itemizing?", usesItemized ? 1 : 0, usesItemized ? `Itemized (${usd(itemized)}) beats standard (${usd(standard)}).` : `Standard (${usd(standard)}) beats itemized (${usd(itemized)}).`, ["itemizedDeductions", "standardDeduction"], "flag");
  const deduction = L.put("deduction", "Deduction taken", Math.max(itemized, standard), usesItemized ? "Itemized deductions, since they exceed the standard deduction." : "The standard deduction, since it exceeds your itemized deductions.", ["usesItemized"]);

  const taxableIncome = L.put("taxableIncome", "Taxable income", Math.max(0, agi - deduction), "AGI minus the deduction taken.", ["agi", "deduction"]);
  const preferential = Math.min(taxableIncome, preferentialGross);
  const ordinaryTaxable = taxableIncome - preferential;
  L.put("ordinaryTaxable", "Ordinary taxable income", ordinaryTaxable, "Taxable income excluding the part taxed at capital gain rates. The deduction is applied to ordinary income first, which is what the IRS worksheet does.", ["taxableIncome"]);
  L.put("preferentialIncome", "Income at capital gain rates", preferential, "Qualified dividends + net long-term gains, stacked on top of ordinary income.", ["taxableIncome"]);

  // Regular tax ---------------------------------------------------------------
  const brackets = p.brackets[fs];
  const marginal = bracketRate(ordinaryTaxable, brackets);
  const bracketEdge = brackets.find((b) => ordinaryTaxable <= b.upTo)?.upTo ?? Infinity;
  const ordinaryTax = L.put(
    "ordinaryTax", "Tax on ordinary income", bracketTax(ordinaryTaxable, brackets),
    `Bracket schedule applied to ${usd(ordinaryTaxable)}. Top dollar is in the ${pct(marginal)} bracket` +
      (Number.isFinite(bracketEdge) ? `, ${usd(bracketEdge - ordinaryTaxable)} below the ${pct(bracketRate(bracketEdge + 1, brackets))} edge.` : "."),
    ["ordinaryTaxable"],
  );
  L.put("marginalBracket", "Ordinary marginal bracket", marginal, "Rate on the next dollar of ordinary income under regular tax.", ["ordinaryTaxable"], "rate");
  const cg = p.capGains[fs];
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
  L.put("isoSharesExercised", "ISO shares exercised", inputs.isoSharesExercised, "The lever. Shares exercised this year, drawn from grants in profile order.", [], "shares");
  L.put(
    "isoBargainElement", "ISO bargain element", inputs.isoBargainElement,
    inputs.isoSharesExercised > 0
      ? `(FMV - strike) x shares exercised. It is income for AMT the year you exercise, even though you sold nothing and it is invisible to regular tax.`
      : "No ISO exercises this year, so no AMT preference from equity.",
    ["isoSharesExercised"],
  );

  const amtOf = (bargain: number) => {
    const amti = taxableIncome + addback + bargain;
    const phaseoutExcess = Math.max(0, amti - p.amt.phaseoutStart[fs]);
    const exemption = Math.max(0, p.amt.exemption[fs] - p.amt.phaseoutRate * phaseoutExcess);
    const base = Math.max(0, amti - exemption);
    const pref = Math.min(base, preferential);
    const ordinaryPart = base - pref;
    const rb = p.amt.rateBreak[fs];
    const ordinaryAmt = Math.min(ordinaryPart, rb) * p.amt.lowRate + Math.max(0, ordinaryPart - rb) * p.amt.highRate;
    const tmt = ordinaryAmt + capGainsTax(pref, ordinaryPart, cg);
    return { amti, phaseoutExcess, exemption, base, ordinaryPart, tmt };
  };
  const a = amtOf(inputs.isoBargainElement);
  L.put("amti", "Alternative minimum taxable income", a.amti, "Taxable income + addbacks + ISO bargain element.", ["taxableIncome", "amtAddbacks", "isoBargainElement"]);
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
  const exclusionOnlyAmt = Math.max(0, amtOf(0).tmt - regularTax);
  const creditGenerated = L.put(
    "amtCreditGenerated", "AMT credit generated", Math.max(0, amt - exclusionOnlyAmt),
    amt > 0
      ? `AMT caused by the ISO bargain element (a timing difference) becomes a credit against future regular tax. ${exclusionOnlyAmt > 0 ? `${usd(exclusionOnlyAmt)} of this year's AMT comes from the SALT/standard deduction addback and is not creditable.` : ""}`
      : "No AMT this year, so no new credit.",
    ["amt"],
  );
  L.put("amtCreditCarryforwardIn", "AMT credit carried in", inputs.amtCreditCarryforwardIn, "Unused minimum tax credit from earlier years.");
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
  const nii = inputs.interest + inputs.qualifiedDividends + Math.max(0, netGains);
  const niitBase = Math.min(nii, Math.max(0, agi - p.niit.threshold[fs]));
  L.put(
    "niit", "Net investment income tax", niitBase * p.niit.rate,
    niitBase > 0
      ? `3.8% of the lesser of net investment income (${usd(nii)}) and AGI over ${usd(p.niit.threshold[fs])} (${usd(agi - p.niit.threshold[fs])}). The threshold is not indexed for inflation.`
      : agi > p.niit.threshold[fs] ? "AGI is over the threshold but there is no investment income." : `AGI is under the ${usd(p.niit.threshold[fs])} threshold.`,
    ["agi", "interest", "qualifiedDividends", "longTermGains"],
  );
  const medicareBase = Math.max(0, inputs.wages - p.additionalMedicare.threshold[fs]);
  L.put("additionalMedicare", "Additional Medicare tax", medicareBase * p.additionalMedicare.rate, medicareBase > 0 ? `0.9% of wages over ${usd(p.additionalMedicare.threshold[fs])}.` : `Wages are under the ${usd(p.additionalMedicare.threshold[fs])} threshold.`, ["wages"]);

  L.put("federalTotal", "Total federal tax", federalIncomeTax + L.get("niit") + L.get("additionalMedicare"), "Federal income tax + NIIT + additional Medicare tax.", ["federalIncomeTax", "niit", "additionalMedicare"]);
}

export function statusName(fs: YearInputs["filingStatus"]): string {
  return { single: "single", mfj: "married filing jointly", mfs: "married filing separately", hoh: "head of household" }[fs];
}
