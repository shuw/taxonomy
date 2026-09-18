import { companyName, companiesWithGrants, exercisedIn, resolveCompany, sharesOutstanding, vestedThrough } from "./equity.ts";
import { activeScenario, leversOf, newEventId, sortedEvents } from "./events.ts";
import { isLongTerm, isQualifying, longTermFrom, qualifyingFrom, type Lot } from "./lots.ts";
import { planYears, runPlan } from "./plan.ts";
import type { ProfileEdit } from "./profile.ts";
import { amtCrossover, creditRecovery, holdOrSell, sharesToCover, sweepIsoExercise, type AmtCrossover, type CreditRecovery, type HoldOrSell } from "./thresholds.ts";
import { DEFAULT_SCENARIO, clone, getPath, setPath } from "./timeline.ts";
import { FIELDS, type FieldDef } from "./fields.ts";
import { newId } from "./equity.ts";
import type { Line, PendingChange, PendingIntake, PlanResult, Profile, Scenario, ScenarioEvent, TimelineEntry, YearResult } from "./types.ts";
import { intakePrompt } from "./intake/prompt.ts";
import { parseIntake } from "./intake/schema.ts";
import { changesToEdits, followUpEdits, reviewIntake, type IntakeSection } from "./intake/apply.ts";
import { int } from "./ledger.ts";
import { profileGaps } from "./gaps.ts";

/**
 * What an agent can do with a profile: read the picture, explain it, try changes, and propose
 * a scenario. Everything here is pure; the MCP server does the file reading and writing. The
 * agent never computes tax and never edits facts: its only write is a new scenario.
 */

/** The ledger lines worth showing an agent per year, in this order. */
export const HEADLINE_LINES = [
  "agi", "taxableIncome", "regularTax", "amt", "amtCreditUsed", "amtCreditCarryforwardOut", "niit", "additionalMedicare", "stateTax", "totalTax", "effectiveRate", "effectiveRateWithSpread",
  "isoSharesExercised", "isoBargainElement", "nsoSharesExercised", "nsoIncome", "rsuSharesVested", "rsuIncome", "sharesSold", "saleProceeds", "netLongTermGain", "netShortTermGain",
  "cashIn", "exerciseCost", "giving", "givingStock", "charitableDeduction", "charitableCarryOut", "isoDisqualifyingIncome", "netCash",
] as const;

export interface YearHeadline { year: number; lines: Record<string, number>; why?: Record<string, string>; events: ScenarioEvent[]; }

const round = (n: number) => Math.round(n * 100) / 100;

/** The lines whose reason is worth carrying without an explain call. */
const WHY_LINES = ["amt", "amtCreditUsed", "amtCreditCarryforwardOut", "charitableDeduction", "charitableCarryOut"];

function headline(y: YearResult, events: ScenarioEvent[]): YearHeadline {
  const lines: Record<string, number> = {};
  for (const id of HEADLINE_LINES) { const l = y.lines[id]; if (l) lines[id] = l.unit === "rate" ? Math.round(l.value * 10_000) / 10_000 : Math.round(l.value); }
  const why: Record<string, string> = {};
  for (const id of WHY_LINES) { const l = y.lines[id]; if (l && l.value > 0) why[id] = l.why; }
  return { year: y.year, lines, ...(Object.keys(why).length ? { why } : {}), events: events.filter((e) => e.year === y.year) };
}

/** The profile with another scenario made active, for running "as if". */
function withScenario(profile: Profile, name: string | undefined, scenario?: Scenario): Profile {
  if (!name && !scenario) return profile;
  const n = name ?? "__tmp";
  return { ...profile, scenarios: { ...(profile.scenarios ?? {}), ...(scenario ? { [n]: scenario } : {}) }, activeScenario: n };
}

function scenarioOf(profile: Profile, name?: string): { name: string; scenario: Scenario } {
  const n = name ?? profile.activeScenario ?? DEFAULT_SCENARIO;
  const s = profile.scenarios?.[n];
  if (!s) throw new Error(`no scenario named "${n}"; have ${Object.keys(profile.scenarios ?? {}).join(", ") || "none"}`);
  return { name: n, scenario: s };
}

/** Orientation: who this is, what they hold, what the plan covers, and the words the tools use. */
export function context(profile: Profile) {
  const years = planYears(profile);
  const start = years[0]!;
  const grants = profile.equity.grants.map((g) => ({
    id: g.id, name: g.name, type: g.type, company: g.company ?? profile.equity.companies[0]?.id,
    granted: g.granted, vestedToDate: g.vestedToDate, exercisedToDate: g.exercisedToDate, strike: g.strike,
    outstanding: sharesOutstanding(g), exercisableIn: Object.fromEntries(years.map((y) => [y, g.type === "rsu" ? 0 : vestedThrough(profile, g, y)])),
    settlement: g.settlement, grantDate: g.grantDate,
  }));
  return {
    name: profile.name,
    filer: profile.filer,
    plan: { startYear: start, years, lastYear: years[years.length - 1] },
    people: { self: { salary: profile.people.self.salary, bonus: profile.people.self.bonus }, spouse: profile.people.spouse ? { salary: profile.people.spouse.salary } : undefined },
    companies: profile.equity.companies.map((c) => ({ id: c.id, name: c.name, sharePrice: c.sharePrice, sharePriceAsOf: c.sharePriceAsOf, growth: c.growth ?? profile.assumptions.fmvGrowth, pricePath: c.pricePath, liquidityYear: c.liquidityYear })),
    grants,
    holdings: (profile.equity.holdings ?? []).map((h) => ({ id: h.id, lot: h.lot, quantity: h.quantity, acquired: h.acquired, via: h.via, costBasis: h.costBasis, amtBasis: h.amtBasis })),
    carryforwards: profile.carryforwards,
    assumptions: profile.assumptions,
    scenarios: Object.entries(profile.scenarios ?? {}).map(([name, s]) => ({ name, active: name === (profile.activeScenario ?? DEFAULT_SCENARIO), events: s.events.length, note: s.note })),
    timeline: profile.timeline,
    pending: profile.pending,
    outstanding: outstanding(profile),
    fields: editableFields(profile),
    vocabulary: {
      events: {
        exercise: "{ kind: 'exercise', type: 'iso' | 'nso', year, shares, company?, date? }: exercise vested options; ISO spread goes to AMT, NSO spread is wages. Shares come from that company's grants in file order.",
        sell: "{ kind: 'sell', year, shares, price?, date?, lots? }: sell shares held that year (holdings plus earlier exercises and RSU settlements); lots are picked lowest tax first unless named. Default date December 31.",
        liquidity: "{ kind: 'liquidity', year, price?, company? }: an IPO or tender; settles double-trigger RSUs that year and pins that year's share price.",
      },
      units: "shares are counts; prices and amounts are dollars; rates are fractions (0.1 = 10%); years are calendar years",
      facts: "facts takes changes of { field, value, company?, from?, source? }: field is a path or label from `fields`; company (id or name) picks the company for per-company fields; from is a year, for a change that starts then (a raise, a law change) instead of replacing the fact. Changes are applied at once and logged; the app can undo them.",
      rules: "Never state a tax figure you did not get from a tool. To change the plan, call what_if to show the effect, then scenario(add). Facts and assumptions change only through facts (a sentence from the user) or intake(submit) (documents); every change is logged in the app and can be undone there.",
    },
  };
}

/** What is still missing or waiting, so an agent can ask for it in conversation rather than all at once. */
export function outstanding(profile: Profile) {
  const empty: string[] = [];
  if (!profile.people.self.salary) empty.push("base salary (people.self.salary)");
  if (!(profile.returns?.length)) empty.push("last filed return (no calibration until it is on file)");
  if (profile.equity.grants.length === 0) empty.push("equity grants (none on file; skip if there are none)");
  if (profile.filer.dependents === undefined) empty.push("dependents");
  return {
    questions: (profile.followUps ?? []).filter((f) => !f.resolved).map((f) => ({ id: f.id, text: f.text, about: f.about, kind: f.kind ?? "confirm" })),
    empty,
    gaps: profileGaps(profile).map((g) => ({ id: g.id, section: g.section, text: g.text, oneClickInApp: !!g.fill })),
    documentsAwaitingReview: profile.pendingIntake?.length ?? 0,
    changesAwaitingReview: profile.pending?.length ?? 0,
  };
}

/** Every plan year's headline lines and events, for a scenario (the active one by default). */
export function plan(profile: Profile, scenarioName?: string): { scenario: string; years: YearHeadline[]; totals: PlanResult["totals"] } {
  const { name, scenario } = scenarioOf(profile, scenarioName);
  const p = withScenario(profile, name);
  const result = runPlan(p);
  return { scenario: name, years: result.years.map((y) => headline(y, sortedEvents(scenario.events))), totals: result.totals };
}

/** One ledger line with its reason and the lines it was computed from. */
export function explain(profile: Profile, year: number, lineId: string, scenarioName?: string): { line: Line; deps: Line[] } {
  const { name } = scenarioOf(profile, scenarioName);
  const y = runPlan(withScenario(profile, name)).years.find((r) => r.year === year);
  if (!y) throw new Error(`year ${year} is not in the plan (${planYears(profile).join(", ")})`);
  const line = y.lines[lineId];
  if (!line) throw new Error(`no line "${lineId}" in ${year}; try one of ${y.order.slice(0, 40).join(", ")}`);
  return { line, deps: line.deps.map((d) => y.lines[d]).filter((l): l is Line => !!l) };
}

/** The lines that differ most between two years, with the later year's reasons: the answer to "why is this year so high". */
export function compareYears(profile: Profile, a: number, b: number, scenarioName?: string, limit = 12) {
  const { name } = scenarioOf(profile, scenarioName);
  const years = runPlan(withScenario(profile, name)).years;
  const ya = years.find((r) => r.year === a), yb = years.find((r) => r.year === b);
  if (!ya || !yb) throw new Error(`years must be in the plan (${planYears(profile).join(", ")})`);
  const rows = Object.keys(yb.lines).filter((id) => yb.lines[id]!.unit === "usd").map((id) => ({ id, label: yb.lines[id]!.label, [a]: round(ya.lines[id]?.value ?? 0), [b]: round(yb.lines[id]!.value), delta: round(yb.lines[id]!.value - (ya.lines[id]?.value ?? 0)), why: yb.lines[id]!.why }));
  return rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, limit);
}

/** The largest AMT-free ISO exercise in a year, and the shape of AMT past it. */
export function amtHeadroom(profile: Profile, year: number, company?: string): AmtCrossover & { perShareAmtPastLine: number; exercisingAllAmt: number } {
  const c = company ?? companiesWithGrants(profile, "iso")[0];
  if (!c) throw new Error("no ISO grants in this profile");
  const cross = amtCrossover(profile, undefined, year, c);
  const sweep = sweepIsoExercise(profile, undefined, year, 20, c);
  const last = sweep[sweep.length - 1];
  const perShare = last && last.shares > cross.sharesBeforeAmt ? last.amt / (last.shares - cross.sharesBeforeAmt) : 0;
  return { ...cross, perShareAmtPastLine: round(perShare), exercisingAllAmt: round(last?.amt ?? 0) };
}

export function recovery(profile: Profile, year: number, company?: string): CreditRecovery | null {
  return creditRecovery(profile, undefined, year, company);
}

export function holdVersusSell(profile: Profile, year: number, company?: string): HoldOrSell | null {
  return holdOrSell(profile, undefined, year, company);
}

/** Shares held in a year before its sales, with each lot's tax status on a date (December 31 by default). */
export function lots(profile: Profile, year: number, date?: string): { date: string; held: number; lots: (Lot & { status: string; longTermFrom: string; qualifyingFrom?: string })[] } {
  const y = runPlan(profile).years.find((r) => r.year === year);
  if (!y) throw new Error(`year ${year} is not in the plan`);
  const d = date ?? `${year}-12-31`;
  const list = (y.lotsBefore ?? []).map((l) => {
    const q = isQualifying(l, d), lt = isLongTerm(l, d);
    const status = q === true ? "qualifying" : q === false ? (lt ? "long-term but disqualifying" : "disqualifying") : lt ? "long-term" : "short-term";
    return { ...l, status, longTermFrom: longTermFrom(l.acquired), qualifyingFrom: l.via === "iso_exercise" ? qualifyingFrom(l) : undefined };
  });
  return { date: d, held: list.reduce((s, l) => s + l.quantity, 0), lots: list };
}

/** The smallest sale in a year whose proceeds pay that year's whole tax. */
export function sellToCover(profile: Profile, year: number): { shares: number; year: number } {
  const { name, scenario } = scenarioOf(profile);
  const id = "__cover";
  const probe: Scenario = { events: [...scenario.events, { id, kind: "sell", year, shares: 0 }] };
  return { year, shares: sharesToCover(withScenario(profile, name, probe), undefined, year, id) };
}

/** Input shape an agent supplies for an event; ids are assigned here. */
export type EventInput = Omit<Extract<ScenarioEvent, { kind: "exercise" }>, "id"> | Omit<Extract<ScenarioEvent, { kind: "sell" }>, "id"> | Omit<Extract<ScenarioEvent, { kind: "liquidity" }>, "id"> | Omit<Extract<ScenarioEvent, { kind: "give" }>, "id">;

/** Check and complete agent-supplied events against the profile. */
export function normalizeEvents(profile: Profile, inputs: EventInput[], existing: ScenarioEvent[] = [], reserved: string[] = []): ScenarioEvent[] {
  const years = planYears(profile);
  const out: ScenarioEvent[] = [...existing];
  const taken = new Set(reserved);
  for (let e of inputs) {
    if (!years.includes(e.year)) throw new Error(`year ${e.year} is not in the plan (${years[0]}–${years[years.length - 1]})`);
    const company = (e as { company?: string }).company;
    if (company !== undefined && !profile.equity.companies.some((c) => c.id === company)) {
      // A name is accepted in place of an id.
      const byName = profile.equity.companies.find((c) => c.name.toLowerCase() === company.toLowerCase());
      if (!byName) throw new Error(`no company "${company}"; have ${profile.equity.companies.map((c) => `${c.id} (${c.name})`).join(", ")}`);
      e = { ...e, company: byName.id } as EventInput;
    }
    if (e.kind === "exercise") {
      if (!["iso", "nso"].includes(e.type)) throw new Error(`exercise type must be iso or nso`);
      if (!(e.shares > 0)) throw new Error("shares must be more than 0");
      const c = resolveCompany(profile, e.company ?? "*");
      if (!profile.equity.grants.some((g) => g.type === e.type && (g.company ?? profile.equity.companies[0]?.id) === c)) throw new Error(`no ${e.type.toUpperCase()} grants for company ${c}`);
    }
    if (e.kind === "sell" && !(e.shares > 0)) throw new Error("shares must be more than 0");
    if (e.kind === "give") {
      if (!["cash", "stock", "daf"].includes(e.how)) throw new Error("how must be cash, stock or daf");
      if (!(e.amount > 0)) throw new Error("amount must be more than 0");
    }
    const id = newEventId([...out, ...[...taken].map((id) => ({ id }) as ScenarioEvent)]);
    taken.add(id);
    out.push({ ...e, id } as ScenarioEvent);
  }
  return out;
}

export interface Delta { year: number; totalTax: number; netCash: number; amt: number; }

function deltas(base: PlanResult, next: PlanResult): { byYear: Delta[]; totalTax: number; netCash: number } {
  const byYear = next.years.map((y) => {
    const b = base.years.find((x) => x.year === y.year);
    const d = (id: string) => round((y.lines[id]?.value ?? 0) - (b?.lines[id]?.value ?? 0));
    return { year: y.year, totalTax: d("totalTax"), netCash: d("netCash"), amt: d("amt") };
  });
  return { byYear, totalTax: round(byYear.reduce((s, d) => s + d.totalTax, 0)), netCash: round(byYear.reduce((s, d) => s + d.netCash, 0)) };
}

/**
 * Try events on top of the active scenario (optionally removing some of its events by id)
 * without writing anything. Returns the resulting years and the change against the active plan.
 */
export function whatIf(profile: Profile, add: EventInput[], remove: string[] = [], basedOn?: string) {
  const { name, scenario } = scenarioOf(profile, basedOn);
  const warnings: string[] = [];
  for (const id of remove) if (!scenario.events.some((e) => e.id === id)) warnings.push(`no event "${id}" in scenario "${name}"; nothing removed for it`);
  const kept = scenario.events.filter((e) => !remove.includes(e.id));
  const events = normalizeEvents(profile, add, kept, scenario.events.map((e) => e.id));
  const trial: Scenario = { events };
  const base = runPlan(withScenario(profile, name));
  const next = runPlan(withScenario(profile, "__whatif", trial));
  warnings.push(...clampWarnings(events, next));
  return { basedOn: name, events, years: next.years.map((y) => headline(y, sortedEvents(events))), totals: next.totals, delta: deltas(base, next), ...(warnings.length ? { warnings } : {}) };
}

/** An event asking for more shares than are exercisable or held runs with what there is; say so rather than let the echoed event mislead. */
function clampWarnings(events: ScenarioEvent[], plan: PlanResult): string[] {
  const out: string[] = [];
  for (const y of plan.years) {
    const asked = (kind: "exercise" | "sell", type?: "iso" | "nso") => events.filter((e) => e.year === y.year && e.kind === kind && (kind === "sell" || (e as { type: string }).type === type)).reduce((s, e) => s + (e as { shares: number }).shares, 0);
    const ran = (line: string) => Math.round(y.lines[line]?.value ?? 0);
    for (const [type, line] of [["iso", "isoSharesExercised"], ["nso", "nsoSharesExercised"]] as const) {
      const want = asked("exercise", type);
      if (want > ran(line)) out.push(`${y.year}: asked to exercise ${int(want)} ${type.toUpperCase()} shares, but only ${int(ran(line))} were vested and unexercised by the exercise date; ${int(ran(line))} ran`);
    }
    const sell = asked("sell");
    if (sell > ran("sharesSold")) out.push(`${y.year}: asked to sell ${int(sell)} shares, but only ${int(ran("sharesSold"))} were held; ${int(ran("sharesSold"))} sold`);
  }
  return out;
}

/**
 * The edits that record a proposal as a new scenario, plus its effect. The active scenario is
 * left alone; the app shows the proposal and the user accepts or discards it.
 */
export function proposeScenario(profile: Profile, name: string, add: EventInput[], opts: { basedOn?: string; remove?: string[]; note?: string } = {}) {
  const clean = name.trim();
  if (!clean) throw new Error("a scenario needs a name");
  if (profile.scenarios?.[clean]) throw new Error(`a scenario named "${clean}" already exists; pick another name or delete it first`);
  const trial = whatIf(profile, add, opts.remove ?? [], opts.basedOn);
  const scenario: Scenario = { events: trial.events, note: opts.note ?? `proposed by your agent on ${new Date().toISOString().slice(0, 10)}, based on ${trial.basedOn}` };
  const edits: ProfileEdit[] = [{ path: ["scenarios", clean], value: scenario }];
  return { name: clean, edits, years: trial.years, totals: trial.totals, delta: trial.delta, ...(trial.warnings ? { warnings: trial.warnings } : {}) };
}

export function setActiveScenario(profile: Profile, name: string): ProfileEdit[] {
  scenarioOf(profile, name);
  return [{ path: ["activeScenario"], value: name }];
}

export function deleteScenario(profile: Profile, name: string): ProfileEdit[] {
  const { name: n } = scenarioOf(profile, name);
  const names = Object.keys(profile.scenarios ?? {});
  if (names.length <= 1) throw new Error("cannot delete the only scenario");
  const edits: ProfileEdit[] = [{ path: ["scenarios", n], value: undefined }];
  if ((profile.activeScenario ?? DEFAULT_SCENARIO) === n) edits.push({ path: ["activeScenario"], value: names.find((x) => x !== n) });
  return edits;
}

/** Short names for what a year holds, for a one-paragraph summary. */
export function describeYear(profile: Profile, y: YearHeadline): string {
  const parts: string[] = [];
  for (const e of y.events) {
    if (e.kind === "exercise") parts.push(`exercise ${int(e.shares)} ${e.type.toUpperCase()}s${profile.equity.companies.length > 1 ? ` (${companyName(profile, e.company)})` : ""}`);
    else if (e.kind === "sell") parts.push(`sell ${int(e.shares)} shares`);
    else if (e.kind === "give") parts.push(`give $${int(e.amount)} ${e.how === "stock" ? "in shares" : e.how === "daf" ? "to a donor-advised fund" : "cash"}`);
    else parts.push(`liquidity event${e.price ? ` at $${e.price}` : ""}`);
  }
  const l = y.lines;
  const usd = (n = 0) => `$${int(n)}`;
  return `${y.year}: ${parts.length ? parts.join(", ") + ". " : ""}AGI ${usd(l.agi)}, total tax ${usd(l.totalTax)}${l.amt ? ` of which AMT ${usd(l.amt)}` : ""}, net cash ${usd(l.netCash)}.`;
}

/** What accepting `after` in place of `before` does to the plan. */
export function effect(before: Profile, after: Profile) {
  return deltas(runPlan(before), runPlan(after));
}

/**
 * "Missing" follow-ups whose value has since arrived with a source (from a document, the agent,
 * or an answer in the app) are marked resolved, so the queue only lists what is still open.
 */
export function answeredFollowUps(profile: Profile): ProfileEdit[] {
  const list = profile.followUps ?? [];
  const answered = (about: string): boolean => {
    if (profile.sources?.[about]) return true;
    if (about === "people.self.salary") return profile.people.self.salary > 0;
    if (about === "filer.dependents") return profile.filer.dependents !== undefined && profile.filer.dependents.every((d) => d.birthYear !== undefined);
    if (about === "home.mortgage.rate") return (profile.home?.mortgage?.rate ?? 0) > 0;
    if (about === "carryforwards.amtCredit") return (profile.carryforwards?.amtCredit ?? 0) > 0;
    return false;
  };
  const next = list.map((f) => (f.kind === "missing" && !f.resolved && f.about && answered(f.about) ? { ...f, resolved: true } : f));
  return next.some((f, i) => f !== list[i]) ? [{ path: ["followUps"], value: next }] : [];
}

/** Scenarios an agent proposed (they carry a note) that are not the active one, each with its effect against the active plan. */
export function proposals(profile: Profile): { name: string; note: string; events: ScenarioEvent[]; delta: ReturnType<typeof deltas> }[] {
  const active = scenarioOf(profile);
  const names = Object.keys(profile.scenarios ?? {}).filter((n) => n !== active.name && profile.scenarios![n]!.note);
  if (names.length === 0) return [];
  const base = runPlan(profile);
  return names.map((name) => {
    const scenario = profile.scenarios![name]!;
    const next = runPlan(withScenario(profile, name));
    const added = scenario.events.filter((e) => !active.scenario.events.some((a) => a.id === e.id && JSON.stringify(a) === JSON.stringify(e)));
    return { name, note: scenario.note!, events: sortedEvents(added), delta: deltas(base, next) };
  });
}

export { exercisedIn, leversOf, activeScenario };

/** The same request the app hands to an agent, for an agent that is already here: read the documents, then call apply_intake. */
export function intakeRequest(profile: Profile, sections: IntakeSection[]): string {
  return intakePrompt({ sections, profile });
}

/**
 * Hand in an intake document. It is parsed here so the agent hears about shape problems at
 * once, then stored on the profile for the same review the app runs on a pasted document.
 * Nothing is written to the facts until the user accepts rows there.
 */
export function submitIntake(profile: Profile, text: string, sections?: IntakeSection[]): { edits: ProfileEdit[]; found: number; questions: number; problems: string[]; warnings: string[] } {
  const parsed = parseIntake(text);
  const warnings = parsed.warnings.map((w) => `${w.path}: ${w.message}`);
  if (!parsed.doc) return { edits: [], found: 0, questions: 0, problems: parsed.problems.map((p) => `${p.path}: ${p.message}`), warnings };
  const review = reviewIntake(parsed.doc, profile);
  const existing = profile.pendingIntake ?? [];
  const doc: PendingIntake = { id: newId("d", existing.map((d) => d.id)), text: text.trim(), submitted: new Date().toISOString(), sections };
  return {
    edits: [{ path: ["pendingIntake"], value: [...existing, doc] }],
    found: review.changes.filter((c) => c.status !== "same").length,
    questions: review.questions.length,
    problems: [],
    warnings,
  };
}

/**
 * Apply an intake document outright: every changed value is written with its source, the
 * agent's questions become follow-ups. The change is logged like any other, so it can be undone.
 */
export function applyIntake(profile: Profile, text: string): { edits: ProfileEdit[]; applied: { path: string; label: string; from: unknown; to: unknown; source?: string }[]; questions: number; problems: string[]; warnings: string[] } {
  const parsed = parseIntake(text);
  const warnings = parsed.warnings.map((w) => `${w.path}: ${w.message}`);
  if (!parsed.doc) return { edits: [], applied: [], questions: 0, problems: parsed.problems.map((p) => `${p.path}: ${p.message}`), warnings };
  const review = reviewIntake(parsed.doc, profile);
  const changes = review.changes.filter((c) => c.status !== "same");
  return {
    edits: [...changesToEdits(changes, profile), ...followUpEdits(review, profile)],
    applied: changes.map((c) => ({ path: c.path.join("."), label: c.label, from: c.current, to: c.proposed, source: c.source, ...(c.note ? { note: c.note } : {}) })),
    questions: review.questions.length,
    problems: [],
    warnings,
  };
}

// ---- facts and assumptions, as reviewable pending changes ----

const COMPANY_PREFIX = "equity.companies.0.";
const isEditable = (f: FieldDef) => f.review !== false && !f.path.startsWith("returns.") && f.path !== "filer.dependents";

/** The registry fields an agent may propose changes to, with their current values. */
function editableFields(profile: Profile) {
  return FIELDS.filter(isEditable).map((f) => ({
    field: f.path, label: f.label, type: f.type, enum: f.enum, hint: f.hint,
    perCompany: f.path.startsWith(COMPANY_PREFIX) || undefined,
    datable: f.timeline || undefined,
    current: f.path.startsWith(COMPANY_PREFIX)
      ? Object.fromEntries(profile.equity.companies.map((c, i) => [c.id, getPath(profile, f.path.replace(COMPANY_PREFIX, `equity.companies.${i}.`))]))
      : getPath(profile, f.path),
  }));
}

export interface FactChangeInput { field: string; value: unknown; company?: string; from?: number; until?: number; source?: string; }

function resolveField(profile: Profile, name: string, company?: string): { def: FieldDef; path: string } {
  const key = name.trim().replace(/^equity\.companies\.\d+\./, COMPANY_PREFIX);
  const editable = FIELDS.filter(isEditable);
  let def = editable.find((f) => f.path === key) ?? editable.find((f) => f.label.toLowerCase() === key.toLowerCase());
  if (!def) {
    const tail = editable.filter((f) => f.path.toLowerCase().endsWith(`.${key.toLowerCase()}`) && (profile.people.spouse || !f.path.startsWith("people.spouse.")));
    if (tail.length === 1) def = tail[0];
    else if (tail.length > 1) throw new Error(`"${name}" is ambiguous: ${tail.map((f) => f.path).join(", ")}`);
  }
  if (!def) throw new Error(`no field "${name}"; the fields are listed by get_context`);
  if (!def.path.startsWith(COMPANY_PREFIX)) return { def, path: def.path };
  const companies = profile.equity.companies;
  const i = company === undefined ? 0 : companies.findIndex((c) => c.id === company || c.name.toLowerCase() === company.toLowerCase());
  if (i < 0) throw new Error(`no company "${company}"; have ${companies.map((c) => `${c.id} (${c.name})`).join(", ")}`);
  if (!companies[i]) throw new Error("no companies on file");
  return { def, path: def.path.replace(COMPANY_PREFIX, `equity.companies.${i}.`) };
}

function num(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const m = /^\s*\$?\s*(-?[\d,]*\.?\d+)\s*([kKmM%])?\s*$/.exec(raw);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ""));
  const suffix = m[2]?.toLowerCase();
  return suffix === "k" ? n * 1_000 : suffix === "m" ? n * 1_000_000 : suffix === "%" ? n / 100 : n;
}

/** A value in the field's own type; percentages are fractions, and "20", "20%" and 0.2 all mean twenty percent. */
export function coerceValue(def: FieldDef, raw: unknown): unknown {
  const bad = () => new Error(`${def.label}: cannot read ${JSON.stringify(raw)} as ${def.type}`);
  switch (def.type) {
    case "usd": case "number": { const n = num(raw); if (n === undefined) throw bad(); return n; }
    case "pct": { let n = num(raw); if (n === undefined) throw bad(); if (typeof raw === "string" && raw.includes("%")) return n; if (Math.abs(n) > 1) n /= 100; return n; }
    case "year": { const n = num(raw); if (n === undefined || !Number.isInteger(n) || n < 1900 || n > 2200) throw bad(); return n; }
    case "bool": {
      if (typeof raw === "boolean") return raw;
      const t = String(raw).trim().toLowerCase();
      if (["true", "on", "yes", "1"].includes(t)) return true;
      if (["false", "off", "no", "0"].includes(t)) return false;
      throw bad();
    }
    case "enum": { const t = String(raw).trim().toLowerCase(); if (!def.enum?.includes(t)) throw new Error(`${def.label} must be one of ${def.enum?.join(", ")}`); return t; }
    case "date": { const t = String(raw).trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw bad(); return t; }
    case "text": return String(raw).trim();
  }
}

/** The profile with pending changes applied, for showing their effect. */
export function profileWithPending(profile: Profile, pending: PendingChange[] = profile.pending ?? []): Profile {
  const out = clone(profile);
  const timeline: TimelineEntry[] = [...(out.timeline ?? [])];
  for (const p of pending) {
    if (p.from !== undefined) timeline.push({ id: newId("t", timeline.map((t) => t.id ?? "")), year: p.from, until: p.until, path: p.path, value: p.value, note: p.source });
    else setPath(out as unknown as Record<string, unknown>, p.path, p.value);
  }
  out.timeline = timeline.length ? timeline : undefined;
  out.pending = undefined;
  return out;
}

export interface PendingRow { id: string; field: string; label: string; current: unknown; proposed: unknown; from?: number; until?: number; source?: string; }

function rowOf(profile: Profile, p: PendingChange): PendingRow {
  const def = FIELDS.find((f) => f.path === p.path.replace(/^equity\.companies\.\d+\./, COMPANY_PREFIX));
  const m = /^equity\.companies\.(\d+)\./.exec(p.path);
  const company = m ? profile.equity.companies[Number(m[1])] : undefined;
  return { id: p.id, field: p.path, label: `${def?.label ?? p.path}${company && profile.equity.companies.length > 1 ? ` (${company.name})` : ""}`, current: getPath(profile, p.path), proposed: p.value, from: p.from, until: p.until, source: p.source };
}

/** What is waiting for review, and what accepting all of it would do to the plan. */
export function pendingReview(profile: Profile): { rows: PendingRow[]; delta: ReturnType<typeof deltas> | null } {
  const pending = profile.pending ?? [];
  if (pending.length === 0) return { rows: [], delta: null };
  return { rows: pending.map((p) => rowOf(profile, p)), delta: deltas(runPlan(profile), runPlan(profileWithPending(profile))) };
}

/**
 * Propose changes to facts or assumptions. They are checked against the field registry, coerced
 * to the field's type, and written to `pending`; the app shows them with before and after values
 * and nothing counts until accepted there.
 */
export function updateFacts(profile: Profile, changes: FactChangeInput[]): { edits: ProfileEdit[]; rows: PendingRow[]; delta: ReturnType<typeof deltas> } {
  if (changes.length === 0) throw new Error("no changes given");
  const years = planYears(profile);
  const existing = profile.pending ?? [];
  const taken = existing.map((p) => p.id);
  const today = new Date().toISOString().slice(0, 10);
  const added: PendingChange[] = changes.map((c) => {
    const { def, path } = resolveField(profile, c.field, c.company);
    const value = coerceValue(def, c.value);
    if (c.from !== undefined) {
      if (!def.timeline) throw new Error(`${def.label} cannot change from a year; leave "from" out`);
      if (!years.includes(c.from)) throw new Error(`year ${c.from} is not in the plan (${years[0]}–${years[years.length - 1]})`);
      if (c.until !== undefined && (!years.includes(c.until) || c.until < c.from)) throw new Error(`until must be a plan year on or after ${c.from}`);
      if (c.until !== undefined && path.startsWith("deductions.charitable.")) throw new Error("a gift in one year is a decision: use scenario(add) with a give event; the charitable fields are the amount given every year");
    }
    const id = newId("p", taken);
    taken.push(id);
    return { id, path, value, from: c.from, until: c.from !== undefined ? c.until : undefined, source: c.source, proposed: today };
  });
  const pending = [...existing.filter((p) => !added.some((a) => a.path === p.path && a.from === p.from)), ...added];
  const next = { ...profile, pending };
  return { edits: [{ path: ["pending"], value: pending }], rows: added.map((p) => rowOf(next, p)), delta: deltas(runPlan(profile), runPlan(profileWithPending(profile, pending))) };
}

/** Drop grants or holdings by id ("grants.g2", "holdings.h1"), with their sources. */
export function removeEquity(profile: Profile, ids: string[]): ProfileEdit[] {
  const edits: ProfileEdit[] = [];
  const grants = ids.filter((i) => i.startsWith("grants.")).map((i) => i.slice(7));
  const holdings = ids.filter((i) => i.startsWith("holdings.")).map((i) => i.slice(9));
  const bad = ids.filter((i) => !i.startsWith("grants.") && !i.startsWith("holdings."));
  if (bad.length) throw new Error(`remove takes grants.<id> or holdings.<id>; not ${bad.join(", ")}`);
  for (const id of grants) if (!profile.equity.grants.some((g) => g.id === id)) throw new Error(`no grant "${id}"; have ${profile.equity.grants.map((g) => g.id).join(", ") || "none"}`);
  for (const id of holdings) if (!(profile.equity.holdings ?? []).some((h) => h.id === id)) throw new Error(`no holding "${id}"; have ${(profile.equity.holdings ?? []).map((h) => h.id).join(", ") || "none"}`);
  if (grants.length) edits.push({ path: ["equity", "grants"], value: profile.equity.grants.filter((g) => !grants.includes(g.id) && !(g.splitOf && grants.includes(g.splitOf))) });
  if (holdings.length) edits.push({ path: ["equity", "holdings"], value: (profile.equity.holdings ?? []).filter((h) => !holdings.includes(h.id)) });
  for (const id of ids) if (profile.sources?.[id] !== undefined) edits.push({ path: ["sources", id], value: undefined });
  return edits;
}

/** Accept or discard pending changes by id (all of them when none are named). Accepting records the source. */
export function resolvePending(profile: Profile, ids: string[] | undefined, accept: boolean): ProfileEdit[] {
  const pending = profile.pending ?? [];
  const chosen = ids?.length ? pending.filter((p) => ids.includes(p.id)) : pending;
  if (chosen.length === 0) throw new Error(ids?.length ? `no pending change named ${ids.join(", ")}` : "nothing is pending");
  const rest = pending.filter((p) => !chosen.includes(p));
  const edits: ProfileEdit[] = [{ path: ["pending"], value: rest.length ? rest : undefined }];
  if (!accept) return edits;
  const timeline: TimelineEntry[] = [...(profile.timeline ?? [])];
  let timelineChanged = false;
  for (const p of chosen) {
    const source = { doc: "your agent", asOf: p.proposed, note: p.source };
    if (p.from !== undefined) {
      const id = newId("t", timeline.map((t) => t.id ?? ""));
      timeline.push({ id, year: p.from, until: p.until, path: p.path, value: p.value, note: p.source });
      timelineChanged = true;
    } else {
      edits.push({ path: p.path.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s)), value: p.value });
      edits.push({ path: ["sources", p.path], value: source });
    }
  }
  if (timelineChanged) edits.push({ path: ["timeline"], value: timeline });
  return edits;
}
