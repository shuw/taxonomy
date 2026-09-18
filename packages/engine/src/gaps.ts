import { latestReturn } from "./calibration.ts";
import { activeScenario, newEventId } from "./events.ts";
import { grantsMissingVesting } from "./equity.ts";
import type { ProfileEdit } from "./profile.ts";
import { DEFAULT_SCENARIO } from "./timeline.ts";
import type { EquityGrant, Holding, Profile, ScenarioEvent } from "./types.ts";
import { int } from "./ledger.ts";

export interface Gap {
  id: string;
  text: string;
  /** Edits that close the gap in one click, when a sensible fill exists. */
  fill?: { label: string; edits: ProfileEdit[] };
  section: string;
}

/** An option lot exercised on or after the first plan year: the plan should tax that exercise, not treat the lot as opening stock. */
export const isPlanExerciseLot = (profile: Profile, h: Holding): boolean =>
  (h.via === "iso_exercise" || h.via === "nso_exercise") && Number(h.acquired.slice(0, 4)) >= profile.plan.startYear;

export interface LotAsExercise {
  event: ScenarioEvent;
  /** The lot's value at exercise is a known price for that year, when none is set. */
  price?: { companyIndex: number; year: number; value: number };
  /** The grant whose exercised count already includes these shares, and the count without them. */
  exercised?: { grantIndex: number; value: number };
}

/** The decision an in-plan lot stands for, and the counts that move with it. `countsAsOf` is when the grants' counts were read. */
export function lotAsExercise(profile: Profile, h: Holding, events: ScenarioEvent[], countsAsOf?: string): LotAsExercise {
  const type = h.via === "iso_exercise" ? "iso" : "nso";
  const year = Number(h.acquired.slice(0, 4));
  const companyId = h.company ?? profile.equity.companies[0]?.id;
  const event: ScenarioEvent = { id: newEventId(events), kind: "exercise", type, year, date: h.acquired, shares: h.quantity, ...(h.company ? { company: h.company } : {}) };
  const ci = profile.equity.companies.findIndex((c) => c.id === companyId);
  const price = h.amtBasis && h.amtBasis > 0 && ci >= 0 && profile.equity.companies[ci]!.pricePath?.[year] === undefined ? { companyIndex: ci, year, value: h.amtBasis } : undefined;
  const gi = grantForLot(profile.equity.grants, h, profile.equity.companies[0]?.id, countsAsOf);
  const exercised = gi >= 0 ? { grantIndex: gi, value: profile.equity.grants[gi]!.exercisedToDate! - h.quantity } : undefined;
  return { event, price, exercised };
}

/**
 * The grant whose exercised count already includes this lot's shares: same type and company,
 * counts read on or after the exercise, enough exercised to cover it. The lot's grant date breaks
 * a tie between grants; otherwise the first in file order. -1 when none qualifies.
 */
export function grantForLot(grants: EquityGrant[], h: Holding, defaultCompany: string | undefined, countsAsOf?: string): number {
  const type = h.via === "iso_exercise" ? "iso" : "nso";
  const companyId = h.company ?? defaultCompany;
  const fits = (g: EquityGrant) => g.type === type && (g.company ?? defaultCompany) === companyId && (g.exercisedToDate ?? 0) >= h.quantity && (countsAsOf ?? g.countsAsOf ?? "9999") >= h.acquired;
  const byDate = h.grantDate ? grants.findIndex((g) => fits(g) && g.grantDate === h.grantDate) : -1;
  return byDate >= 0 ? byDate : grants.findIndex(fits);
}

/** Facts the profile is probably missing, judged against the last filed return. Nothing is changed; these are suggestions. */
export function profileGaps(profile: Profile): Gap[] {
  const gaps: Gap[] = [];
  const r = latestReturn(profile);
  const inc = profile.income;
  const yr = r?.year;
  const fromReturn = (label: string) => `assumed from the ${yr} return (${label})`;
  if (r) {
    const i = r.inputs;
    if ((inc.interest ?? 0) === 0 && (i.interest ?? 0) > 0) gaps.push({ id: "income.interest", section: "Other income", text: `Your ${yr} return shows ${usd(i.interest!)} of interest; this year has none.`, fill: { label: `Use ${usd(i.interest!)}`, edits: [{ path: ["income", "interest"], value: i.interest! }, { path: ["sources", ["income", "interest"].join(".")], value: fromReturn("1040 line 2b") }] } });
    if ((inc.ordinaryDividends ?? 0) === 0 && (i.ordinaryDividends ?? 0) > 0) gaps.push({ id: "income.ordinaryDividends", section: "Other income", text: `Your ${yr} return shows ${usd(i.ordinaryDividends!)} of dividends (${usd(i.qualifiedDividends ?? 0)} qualified); this year has none.`, fill: { label: `Use ${usd(i.ordinaryDividends!)}`, edits: [{ path: ["income", "ordinaryDividends"], value: i.ordinaryDividends! }, { path: ["sources", ["income", "ordinaryDividends"].join(".")], value: fromReturn("1040 line 3b") }] } });
    if ((inc.qualifiedDividends ?? 0) === 0 && (i.qualifiedDividends ?? 0) > 0 && (inc.ordinaryDividends ?? 0) > 0) gaps.push({ id: "income.qualifiedDividends", section: "Other income", text: `${yr} had ${usd(i.qualifiedDividends!)} of qualified dividends; this year's qualified figure is 0.`, fill: { label: `Use ${usd(i.qualifiedDividends!)}`, edits: [{ path: ["income", "qualifiedDividends"], value: i.qualifiedDividends! }, { path: ["sources", ["income", "qualifiedDividends"].join(".")], value: fromReturn("1040 line 3a") }] } });
  }
  const self = profile.people.self;
  if ((self.pretaxContributions ?? 0) === 0 && self.salary > 0) gaps.push({ id: "people.self.pretaxContributions", section: "You", text: "No pre-tax contributions recorded (401(k), HSA).", fill: { label: "Use the 401(k) limit, $24,500", edits: [{ path: ["people", "self", "pretaxContributions"], value: 24_500 }, { path: ["sources", "people.self.pretaxContributions"], value: "assumed: 2026 401(k) limit" }] } });
  if (profile.filer.filingStatus === "mfj" && !profile.people.spouse) gaps.push({ id: "people.spouse", section: "You", text: "Filing jointly, but no spouse income is recorded. Add it in the You section if there is any." });
  if ((profile.filer.dependents ?? []).length === 0 && (profile.filer.filingStatus === "mfj" || profile.filer.filingStatus === "hoh")) gaps.push({ id: "filer.dependents", section: "You", text: "No dependents recorded." });

  // Equity the plan cannot model as entered.
  for (const g of grantsMissingVesting(profile)) {
    gaps.push({ id: `grants.${g.id}.schedule`, section: "Equity", text: `${g.name}: ${int(g.granted - (g.vestedToDate ?? 0))} unvested ${g.type === "rsu" ? "units" : "shares"} but no vesting schedule, so none of them vest in the plan. Open the grant and set Vesting.` });
  }
  const holdings = profile.equity.holdings ?? [];
  const name = profile.activeScenario ?? DEFAULT_SCENARIO;
  const scenario = activeScenario(profile);
  for (const h of holdings) {
    if (!isPlanExerciseLot(profile, h)) continue;
    const r = lotAsExercise(profile, h, scenario.events);
    const type = h.via === "iso_exercise" ? "ISO" : "NSO";
    const year = r.event.year;
    // Without the value at exercise, modeling the lot would tax the spread at the modeled price for the year, which can be far off.
    if (!(h.amtBasis && h.amtBasis > 0)) {
      gaps.push({ id: `holdings.${h.id}.amtBasis`, section: "Equity", text: `Lot "${h.lot}": ${int(h.quantity)} ${type} shares exercised ${h.acquired}, but the share value at exercise (Form 3921 box 4, or the 409A then) is not recorded. Set AMT basis on the lot; until then the exercise is valued at the modeled ${year} price.` });
    }
    gaps.push({
      id: `holdings.${h.id}.exercise`, section: "Equity",
      text: `Lot "${h.lot}": ${int(h.quantity)} ${type} shares exercised ${h.acquired}, inside the plan, but not modeled, so ${year} is missing its ${type === "ISO" ? "AMT" : "wage income"}. Model it to add the exercise to the ${name} scenario.`,
      fill: { label: `Model it in ${year}`, edits: [
        { path: ["scenarios", name], value: { ...scenario, events: [...scenario.events, r.event] } },
        { path: ["equity", "holdings"], value: holdings.filter((x) => x.id !== h.id) },
        ...(r.price ? [{ path: ["equity", "companies", r.price.companyIndex, "pricePath", String(year)], value: r.price.value }] : []),
        ...(r.exercised ? [{ path: ["equity", "grants", r.exercised.grantIndex, "exercisedToDate"], value: r.exercised.value }] : []),
      ] },
    });
  }
  return gaps;
}

const usd = (n: number) => "$" + int(n);
