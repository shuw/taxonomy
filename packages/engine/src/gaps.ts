import { latestReturn } from "./calibration.ts";
import type { Profile } from "./types.ts";

export interface Gap {
  id: string;
  text: string;
  /** Profile path to set, with the value to use, when a one-click fill makes sense. */
  fill?: { path: (string | number)[]; value: unknown; source: string; label: string };
  section: string;
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
    if ((inc.interest ?? 0) === 0 && (i.interest ?? 0) > 0) gaps.push({ id: "income.interest", section: "Other income", text: `Your ${yr} return shows ${usd(i.interest!)} of interest; this year has none.`, fill: { path: ["income", "interest"], value: i.interest!, source: fromReturn("1040 line 2b"), label: `Use ${usd(i.interest!)}` } });
    if ((inc.ordinaryDividends ?? 0) === 0 && (i.ordinaryDividends ?? 0) > 0) gaps.push({ id: "income.ordinaryDividends", section: "Other income", text: `Your ${yr} return shows ${usd(i.ordinaryDividends!)} of dividends (${usd(i.qualifiedDividends ?? 0)} qualified); this year has none.`, fill: { path: ["income", "ordinaryDividends"], value: i.ordinaryDividends!, source: fromReturn("1040 line 3b"), label: `Use ${usd(i.ordinaryDividends!)}` } });
    if ((inc.qualifiedDividends ?? 0) === 0 && (i.qualifiedDividends ?? 0) > 0 && (inc.ordinaryDividends ?? 0) > 0) gaps.push({ id: "income.qualifiedDividends", section: "Other income", text: `${yr} had ${usd(i.qualifiedDividends!)} of qualified dividends; this year's qualified figure is 0.`, fill: { path: ["income", "qualifiedDividends"], value: i.qualifiedDividends!, source: fromReturn("1040 line 3a"), label: `Use ${usd(i.qualifiedDividends!)}` } });
  }
  const self = profile.people.self;
  if ((self.pretaxContributions ?? 0) === 0 && self.salary > 0) gaps.push({ id: "people.self.pretaxContributions", section: "You", text: "No pre-tax contributions recorded. A 401(k) or HSA lowers taxable wages; 2026's 401(k) limit is $24,500.", fill: { path: ["people", "self", "pretaxContributions"], value: 24_500, source: "assumed: 2026 401(k) limit", label: "Assume $24,500" } });
  if (profile.filer.filingStatus === "mfj" && !profile.people.spouse) gaps.push({ id: "people.spouse", section: "You", text: "Filing jointly, but no spouse income is recorded. Add it in the You section if there is any.", fill: undefined });
  if ((profile.filer.dependents ?? []).length === 0 && (profile.filer.filingStatus === "mfj" || profile.filer.filingStatus === "hoh")) gaps.push({ id: "filer.dependents", section: "You", text: "No dependents recorded. Birth years matter for credits that are coming.", fill: undefined });
  return gaps;
}

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
