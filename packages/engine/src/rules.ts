import { federalParams } from "./params.ts";
import { MODELED_STATES } from "./state/index.ts";
import { usd, pct } from "./ledger.ts";
import type { FilingStatus } from "./types.ts";

export interface RuleGroup { title: string; items: { name: string; detail: string; source?: string }[]; }

const both = (v: Record<FilingStatus, number>) => `${usd(v.single)} single, ${usd(v.mfj)} joint`;

/**
 * What the engine models, stated from its own parameters for a tax year, so the list is what the
 * numbers use rather than a description that can drift. Read by the app's "rules" dialog.
 */
export function modeledRules(year: number, inflation = 0.025): RuleGroup[] {
  const p = federalParams(year, inflation);
  const rates = p.brackets.single.map((b) => b.rate);
  const topStart = p.brackets.single[p.brackets.single.length - 2]!.upTo;
  const topStartMfj = p.brackets.mfj[p.brackets.mfj.length - 2]!.upTo;
  const projected = p.published ? "" : ` (${year} projected from the last published year with ${pct(inflation)} inflation)`;
  return [
    { title: `Federal income tax, ${year}${projected}`, items: [
      { name: "Ordinary income brackets", detail: `${rates.length} rates from ${pct(rates[0]!)} to ${pct(rates[rates.length - 1]!)}; the top rate starts at ${usd(topStart)} single, ${usd(topStartMfj)} joint.`, source: "IRC §1; Rev. Proc. 2025-32" },
      { name: "Standard deduction", detail: both(p.standardDeduction) + ".", source: "IRC §63" },
      { name: "Long-term gains and qualified dividends", detail: `0% up to ${usd(p.capGains.single.zeroUpTo)} of taxable income (${usd(p.capGains.mfj.zeroUpTo)} joint), 15% to ${usd(p.capGains.single.fifteenUpTo)} (${usd(p.capGains.mfj.fifteenUpTo)} joint), 20% above, stacked on ordinary income.`, source: "IRC §1(h)" },
      { name: "Net investment income tax", detail: `${pct(p.niit.rate)} on investment income over ${both(p.niit.threshold)} of AGI.`, source: "IRC §1411" },
      { name: "Additional Medicare tax", detail: `${pct(p.additionalMedicare.rate)} on wages over ${both(p.additionalMedicare.threshold)}.`, source: "IRC §3101(b)(2)" },
      { name: "Capital losses", detail: "Short-term and long-term netted; up to $3,000 a year against ordinary income, the rest carried forward.", source: "IRC §1211, §1212" },
    ] },
    { title: "Deductions", items: [
      { name: "State and local taxes", detail: `Capped at ${both(p.salt.cap)}, shrinking by ${pct(p.salt.phaseoutRate)} of AGI over ${both(p.salt.phaseoutStart)} to a floor of ${usd(p.salt.floor.single)}.`, source: "IRC §164(b)(6), as amended 2025" },
      { name: "Mortgage interest", detail: "Interest on the first $750,000 of acquisition debt ($1,000,000 for loans from before December 16, 2017), amortized month by month.", source: "IRC §163(h)" },
      { name: "Charitable gifts", detail: `Cash and donor-advised funds up to 60% of AGI, appreciated stock up to 30%, excess carried forward five years${p.charitableAgiFloor > 0 ? `; itemizers lose the first ${pct(p.charitableAgiFloor)} of AGI` : ""}.`, source: "IRC §170" },
      { name: "Medical expenses", detail: "The part over 7.5% of AGI.", source: "IRC §213" },
      { name: "Itemized or standard", detail: "Whichever leaves less regular tax plus AMT, since the standard deduction is disallowed under AMT." },
      ...(year >= 2026 ? [{ name: "Top-bracket limit on itemized deductions", detail: "Itemized deductions are cut by 2/37 of the lesser of the deductions or income over the start of the 37% bracket. AMT ignores the cut.", source: "IRC §68, as rewritten 2025" }] : []),
    ] },
    { title: "Alternative minimum tax", items: [
      { name: "Exemption and phase-out", detail: `${both(p.amt.exemption)}, reduced by ${pct(p.amt.phaseoutRate)} of AMTI over ${both(p.amt.phaseoutStart)}.`, source: "IRC §55(d)" },
      { name: "Rates", detail: `${pct(p.amt.lowRate)} up to ${usd(p.amt.rateBreak.single)} of the AMT base, ${pct(p.amt.highRate)} above; gains and dividends keep their rates.`, source: "IRC §55(b)" },
      { name: "ISO bargain element", detail: "The spread on exercised ISOs is AMT income in the exercise year; the shares carry an AMT basis equal to the exercise price plus the spread.", source: "IRC §56(b)(3)" },
      { name: "AMT credit", detail: "AMT from timing items (the ISO spread) becomes a credit against later years' regular tax above tentative minimum tax; AMT from SALT and the standard deduction does not.", source: "IRC §53; Form 8801" },
    ] },
    { title: "Equity compensation", items: [
      { name: "Incentive stock options", detail: "Exercise: no regular income, AMT on the spread. Sale after two years from grant and one from exercise: long-term gain on the whole spread. Earlier: the spread is ordinary income and the rest a gain.", source: "IRC §421, §422" },
      { name: "The $100,000 rule", detail: "Options first exercisable in a year beyond $100,000 of strike value are treated as NSOs; a split tranche follows its ISO's schedule.", source: "IRC §422(d)" },
      { name: "Non-qualified options", detail: "The spread at exercise is wages; the shares' basis is the market value then.", source: "IRC §83" },
      { name: "Restricted stock units", detail: "Wages at vest at that day's value, or at the liquidity event for double-trigger units; the shares' basis is that value." },
      { name: "Vesting", detail: "Monthly, quarterly or annual schedules with a cliff, or dated counts from the portal. An exercise draws only on shares vested by its date." },
      { name: "Sales", detail: "Lots are sold lowest-tax first unless named; holding periods run from exercise or vest; qualifying ISO shares adjust AMT income on sale.", source: "IRC §1222, §56(b)(3)" },
    ] },
    { title: "States", items: MODELED_STATES.map((s) => ({ name: `${s.code} · ${s.name}`, detail: s.code === "WA"
      ? "No income tax. Capital gains excise: 7% on long-term gains over an indexed deduction (2025: $278,000), plus 2.9% over $1,000,000 from 2025. From 2028 the millionaires' tax: 9.9% on income over $1,000,000, switchable off while it is contested."
      : s.code === "CA" ? "Income tax brackets with the 1% mental-health surtax over $1,000,000 and California's own AMT; approximate: no credits, indexed exemptions."
      : `${s.note[0]!.toUpperCase()}${s.note.slice(1)}.`, ...(s.code === "WA" ? { source: "RCW 82.87; SB 5813; SB 6346" } : s.code === "CA" ? { source: "Cal. Rev. & Tax. Code §17041" } : {}) })) },
    { title: "Not modeled yet", items: [
      { name: "Equity", detail: "ESPP, 83(b) elections and early exercise, QSBS." },
      { name: "Payments", detail: "Estimated payments, withholding and penalties; the cash view is by year, not by quarter." },
      { name: "Other states", detail: "Anything beyond the five above." },
      { name: "Retirement", detail: "Roth conversions and contribution changes beyond pre-tax contributions." },
      { name: "Credits", detail: "Child, education and energy credits." },
    ] },
  ];
}
