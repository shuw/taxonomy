import { computeFederal } from "./federal.ts";
import { exerciseCost, exerciseSpread, rsuVesting, sharesExercised } from "./equity.ts";
import { Ledger, pct, usd } from "./ledger.ts";
import { amortize, type MortgageYear } from "./mortgage.ts";
import { federalParams } from "./params.ts";
import { stateModule } from "./state/index.ts";
import { activeLevers, profileInYear } from "./timeline.ts";
import { applySale, lotsFromRsu, lotsFromExercise, openingLots, type Lot, type SaleResult } from "./lots.ts";
import type { Levers, PlanResult, Profile, YearInputs, YearResult } from "./types.ts";

export function planYears(profile: Profile): number[] {
  return Array.from({ length: profile.plan.years }, (_, i) => profile.plan.startYear + i);
}

/** The active scenario's levers with overrides on top. */
export function resolveLevers(profile: Profile, overrides?: Partial<Levers>): Levers {
  const base = activeLevers(profile);
  return {
    exercises: {
      iso: mergeYears(base.exercises.iso, overrides?.exercises?.iso),
      nso: mergeYears(base.exercises.nso, overrides?.exercises?.nso),
    },
    exerciseDates: overrides?.exerciseDates ?? base.exerciseDates,
    sales: overrides?.sales ?? base.sales,
    liquidity: overrides?.liquidity ?? base.liquidity,
  };
}

/** The profile with the scenario's liquidity events applied: each names the year double-trigger RSUs settle and, with a price, pins that year's share price. */
export function profileWithLevers(profile: Profile, levers: Levers): Profile {
  const liq = levers.liquidity;
  if (!liq || Object.keys(liq).length === 0) return profile;
  const companies = profile.equity.companies.map((c) => {
    const l = liq[c.id] ?? liq["*"];
    if (!l) return c;
    return { ...c, liquidityYear: l.year, pricePath: l.price !== undefined ? { ...(c.pricePath ?? {}), [l.year]: l.price } : c.pricePath };
  });
  return { ...profile, equity: { ...profile.equity, companies } };
}

/** Override a year's per-company counts without dropping the other companies. */
function mergeYears(base: Record<number, Record<string, number>>, over?: Record<number, Record<string, number>>): Record<number, Record<string, number>> {
  const out: Record<number, Record<string, number>> = {};
  for (const [y, v] of Object.entries(base)) out[Number(y)] = { ...v };
  for (const [y, v] of Object.entries(over ?? {})) out[Number(y)] = { ...(out[Number(y)] ?? {}), ...v };
  return out;
}

/** Balances that flow from one plan year into the next. */
export interface Carries {
  amtCredit: number;
  capitalLoss: { shortTerm: number; longTerm: number };
  charitable: number;
}

export function openingCarries(profile: Profile): Carries {
  const c = profile.carryforwards ?? {};
  return {
    amtCredit: c.amtCredit ?? 0,
    capitalLoss: { shortTerm: c.capitalLoss?.shortTerm ?? 0, longTerm: c.capitalLoss?.longTerm ?? 0 },
    charitable: c.charitable ?? 0,
  };
}

/**
 * Inputs for one year. `profile` should already be the timeline-adjusted profile for that year
 * (see profileInYear); growth assumptions compound from plan.startYear.
 */
export function yearInputs(profile: Profile, levers: Levers, year: number, carries: Carries, mortgage?: MortgageYear): YearInputs {
  const t = year - profile.plan.startYear;
  const grow = (x: number) => x * (1 + profile.assumptions.wageGrowth) ** t;
  const self = profile.people.self;
  const spouse = profile.people.spouse;
  const inc = profile.income;
  const ded = profile.deductions ?? {};
  const ch = ded.charitable ?? {};
  const iso = sharesExercised(profile, levers, "iso", year);
  const nso = sharesExercised(profile, levers, "nso", year);
  const rsu = rsuVesting(profile, year);
  const ordinaryDividends = inc.ordinaryDividends ?? inc.qualifiedDividends ?? 0;
  const qualified = inc.qualifiedDividends ?? 0;
  return {
    year,
    filingStatus: profile.filer.filingStatus,
    state: profile.filer.state,
    salarySelf: grow(self.salary + (self.bonus ?? 0)),
    salarySpouse: spouse ? grow(spouse.salary + (spouse.bonus ?? 0)) : 0,
    pretaxContributions: (self.pretaxContributions ?? 0) + (spouse?.pretaxContributions ?? 0),
    otherOrdinary: inc.otherOrdinary ?? 0,
    interest: inc.interest ?? 0,
    nonqualifiedDividends: Math.max(0, ordinaryDividends - qualified),
    qualifiedDividends: qualified,
    longTermGains: inc.longTermGains ?? 0,
    shortTermGains: inc.shortTermGains ?? 0,
    capitalLossCarryIn: carries.capitalLoss,
    mortgageInterestPaid: mortgage ? mortgage.interestPaid : profile.home?.mortgageInterest ?? 0,
    mortgageCapFraction: mortgage ? mortgage.capFraction : 1,
    propertyTax: profile.home?.propertyTax ?? 0,
    stateIncomeTax: ded.stateIncomeTax ?? 0,
    charitableCash: (ch.cash ?? 0) + (ch.daf ?? 0),
    charitableStock: ch.appreciatedStock ?? 0,
    charitableCarryIn: carries.charitable,
    medical: ded.medical ?? 0,
    isoSharesExercised: iso,
    isoBargainElement: exerciseSpread(profile, levers, "iso", year),
    nsoSharesExercised: nso,
    nsoIncome: exerciseSpread(profile, levers, "nso", year),
    rsuSharesVested: rsu.shares,
    rsuIncome: rsu.income,
    sharesSold: 0,
    saleProceeds: 0,
    exerciseCost: exerciseCost(profile, levers, "iso", year) + exerciseCost(profile, levers, "nso", year),
    isoDisqualifyingIncome: 0,
    amtCapitalAdjustment: 0,
    amtCreditCarryforwardIn: carries.amtCredit,
    bracketRateDelta: profile.assumptions.bracketRateDelta ?? 0,
  };
}

export function computeYear(profile: Profile, inputs: YearInputs): YearResult {
  const params = federalParams(inputs.year, profile.assumptions.inflation, inputs.bracketRateDelta);
  const ctx = { inflation: profile.assumptions.inflation, policy: profile.assumptions.state ?? {} };
  let ledger = new Ledger();
  computeFederal(inputs, params, ledger);
  stateModule(inputs.state).compute(inputs, ledger, { ...ctx, agi: ledger.get("agi") });
  // A modeled state income tax is deductible federally (within the SALT cap); run once more with it in place.
  const stateIncome = ledger.lines.stateIncomeTax?.value ?? 0;
  if (stateIncome > 0 && inputs.stateIncomeTax === 0) {
    const withState = { ...inputs, stateIncomeTax: stateIncome };
    ledger = new Ledger();
    computeFederal(withState, params, ledger);
    stateModule(inputs.state).compute(withState, ledger, { ...ctx, agi: ledger.get("agi") });
    inputs = withState;
  }
  const total = ledger.put("totalTax", "Total tax", ledger.get("federalTotal") + ledger.get("stateTax"), "Federal + state.", ["federalTotal", "stateTax"]);
  const agi = ledger.get("agi");
  ledger.put("effectiveRate", "Effective rate", agi > 0 ? total / agi : 0, `Total tax as a share of AGI (${usd(agi)}). ISO bargain element is not in AGI, so an exercise year can look expensive by this measure.`, ["totalTax", "agi"], "rate");
  // Cash: what arrives and what leaves, before living costs. Equity income is not cash until sold.
  const cashIn = ledger.put("cashIn", "Cash in", inputs.salarySelf + inputs.salarySpouse + inputs.saleProceeds, "Salary and bonus received, plus proceeds of shares sold. RSU vests and option spreads are income but not cash.", ["salarySelf", ...(inputs.salarySpouse > 0 ? ["salarySpouse"] : []), "sharesSold"]);
  ledger.put("exerciseCost", "Exercise cost", inputs.exerciseCost, inputs.exerciseCost > 0 ? "Shares exercised × strike, paid to the company." : "No options exercised this year.", ["isoSharesExercised"]);
  const cashOut = ledger.put("cashOut", "Cash out", inputs.exerciseCost + total, "Exercise cost + total tax.", ["exerciseCost", "totalTax"]);
  ledger.put("netCash", "Net cash", cashIn - cashOut, "Cash in - cash out, before living costs and withholding timing. Negative means the year needs money from savings or a sale.", ["cashIn", "cashOut"]);
  return { year: inputs.year, inputs, lines: ledger.lines, order: ledger.order };
}

function carriesOut(result: YearResult): Carries {
  const v = (id: string) => result.lines[id]?.value ?? 0;
  return {
    amtCredit: v("amtCreditCarryforwardOut"),
    capitalLoss: { shortTerm: v("capitalLossCarryOutShortTerm"), longTerm: v("capitalLossCarryOutLongTerm") },
    charitable: v("charitableCarryOut"),
  };
}

/** Everything that flows from one plan year into the next. */
export interface PlanState {
  carries: Carries;
  lots: Lot[];
  mortgage: MortgageYear[] | null;
  mortgageKey: string;
}

export function openingState(profile: Profile): PlanState {
  return { carries: openingCarries(profile), lots: openingLots(profile), mortgage: null, mortgageKey: "" };
}

/**
 * Compute one plan year from the state entering it: the timeline shapes the year's facts,
 * exercises and settlements add lots, sales consume them, then the tax runs. `base` is the
 * profile with the scenario's liquidity events applied (profileWithLevers).
 */
export function stepYear(profile: Profile, base: Profile, levers: Levers, year: number, state: PlanState): { result: YearResult; state: PlanState } {
  const i = year - profile.plan.startYear;
  const p = profileInYear(base, year);
  let { mortgage, mortgageKey } = state;
  // Re-amortize only when the loan itself changes on the timeline.
  const key = JSON.stringify(p.home?.mortgage ?? null);
  if (key !== mortgageKey) {
    mortgageKey = key;
    mortgage = p.home?.mortgage ? amortize(p.home.mortgage, year, profile.plan.years - i) : null;
    if (mortgage) mortgage = [...Array(i).fill(undefined), ...mortgage];
  }
  const inputs = yearInputs(p, levers, year, state.carries, mortgage?.[i]);
  // Shares acquired this year: exercises on their event date (January 1 by default), RSU settlements on their vest dates.
  let lots = [
    ...state.lots,
    ...lotsFromExercise(p, levers, "iso", year, levers.exerciseDates?.iso[year] ?? `${year}-01-01`),
    ...lotsFromExercise(p, levers, "nso", year, levers.exerciseDates?.nso[year] ?? `${year}-01-01`),
  ];
  lots.push(...lotsFromRsu(p, year));
  const lotsBefore = lots.map((l) => ({ ...l }));
  const sales: SaleResult[] = [];
  for (const sale of [...(levers.sales?.[year] ?? [])].sort((a, b) => (a.date ?? `${year}-12-31`).localeCompare(b.date ?? `${year}-12-31`))) {
    const { remaining, result } = applySale(p, lots, sale, year);
    lots = remaining;
    sales.push(result);
    inputs.sharesSold += result.shares;
    inputs.saleProceeds += result.proceeds;
    inputs.longTermGains += result.longTermGain;
    inputs.shortTermGains += result.shortTermGain;
    inputs.isoDisqualifyingIncome += result.ordinaryIncome;
    inputs.amtCapitalAdjustment += result.amtAdjustment;
  }
  const result = computeYear(p, inputs);
  result.lotsBefore = lotsBefore;
  result.lotsEnd = lots.map((l) => ({ ...l }));
  result.sales = sales;
  return { result, state: { carries: carriesOut(result), lots, mortgage, mortgageKey } };
}

/** The state entering `year`: every earlier plan year run in sequence. */
export function stateBefore(profile: Profile, levers: Levers, year: number): PlanState {
  const base = profileWithLevers(profile, levers);
  let state = openingState(profile);
  for (const y of planYears(profile)) {
    if (y >= year) break;
    state = stepYear(profile, base, levers, y, state).state;
  }
  return state;
}

/** One year on its own, from a state computed earlier: the cheap way to probe a lever in that year. */
export function yearFrom(profile: Profile, levers: Levers, year: number, state: PlanState): YearResult {
  return stepYear(profile, profileWithLevers(profile, levers), levers, year, state).result;
}

function totals(years: YearResult[], carries: Carries): PlanResult["totals"] {
  const sum = (id: string) => years.reduce((s, y) => s + y.lines[id]!.value, 0);
  return { totalTax: sum("totalTax"), federalTotal: sum("federalTotal"), stateTax: sum("stateTax"), amt: sum("amt"), amtCreditCarryforwardEnd: carries.amtCredit };
}

/**
 * Run every plan year in sequence: the timeline shapes each year's facts, carryforwards thread
 * through, and shares held flow from exercises and settlements into sales.
 */
export function runPlan(profile: Profile, leverOverrides?: Partial<Levers>): PlanResult {
  const levers = resolveLevers(profile, leverOverrides);
  const base = profileWithLevers(profile, levers);
  let state = openingState(profile);
  const years: YearResult[] = [];
  for (const year of planYears(profile)) {
    const step = stepYear(profile, base, levers, year, state);
    years.push(step.result);
    state = step.state;
  }
  return { years, totals: totals(years, state.carries) };
}

/** Continue a plan from the state entering `fromYear` to the end; earlier years are taken from `prefix`. */
export function runPlanFrom(profile: Profile, levers: Levers, fromYear: number, state: PlanState, prefix: YearResult[]): PlanResult {
  const base = profileWithLevers(profile, levers);
  const years = [...prefix];
  for (const year of planYears(profile)) {
    if (year < fromYear) continue;
    const step = stepYear(profile, base, levers, year, state);
    years.push(step.result);
    state = step.state;
  }
  return { years, totals: totals(years, state.carries) };
}

export { pct, usd };
