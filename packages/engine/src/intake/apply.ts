import { newId } from "../equity.ts";
import { fieldByIntake, FIELDS } from "../fields.ts";
import type { ProfileEdit, ProfilePath } from "../profile.ts";
import { getPath } from "../timeline.ts";
import type { Company, EquityGrant, FollowUp, Holding, PriorReturn, Profile } from "../types.ts";
import type { IntakeDocument, IntakeGrant, IntakeQuestion } from "./schema.ts";

export type IntakeSection = "basics" | "pay" | "prior_return" | "income" | "equity" | "home" | "assumptions";

export interface IntakeChange {
  /** Stable id for selection. */
  id: string;
  section: IntakeSection;
  label: string;
  path: ProfilePath;
  current: unknown;
  proposed: unknown;
  source?: string;
  status: "new" | "changed" | "same";
  format: "usd" | "number" | "pct" | "text" | "date" | "year" | "enum" | "bool" | "shares" | "grant" | "holdings" | "mortgage" | "priorReturn" | "companies";
  note?: string;
  /** Key under `sources` when applied (grants and holdings use ids). */
  sourceKey: string;
  /** Dependents' birth years, when the agent gave them rather than a count. */
  birthYears?: number[];
  /** The intake path this row came from, for matching the agent's questions. */
  intakeKey?: string;
}

export interface IntakeReview {
  changes: IntakeChange[];
  /** Paths the agent reported as not found, with a readable label. */
  unknown: { path: string; label: string }[];
  questions: IntakeQuestion[];
  asOf?: string;
}

const strip = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, strip(x)]));
  return v;
};
const same = (a: unknown, b: unknown) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
const toPath = (dot: string): ProfilePath => dot.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s));

/** Compare an intake document to the current profile and list what would change. */
export function reviewIntake(doc: IntakeDocument, profile: Profile): IntakeReview {
  const changes: IntakeChange[] = [];
  const src = (key: string) => doc.sources?.[key];
  const add = (c: Omit<IntakeChange, "status" | "id"> & { id?: string }) => {
    if (c.proposed === undefined) return;
    const status: IntakeChange["status"] = c.current === undefined || c.current === null ? "new" : same(c.current, c.proposed) ? "same" : "changed";
    changes.push({ ...c, id: c.id ?? c.path.join("."), status });
  };

  // Scalars, from the registry -----------------------------------------------
  for (const f of FIELDS) {
    if (f.review === false || !f.intake) continue;
    const proposed = getPath(doc, f.intake);
    if (proposed === undefined) continue;
    if (f.path.startsWith("equity.companies.0.") && profile.equity.companies.length === 0) continue; // handled by the companies row
    if (f.path === "filer.dependents") {
      const years = Array.isArray(proposed) ? (proposed as number[]) : undefined;
      const n = years ? years.length : typeof proposed === "number" ? Math.max(0, Math.round(proposed)) : 0;
      const existing = profile.filer.dependents;
      const curYears = existing?.map((d) => d.birthYear).filter((y): y is number => typeof y === "number") ?? [];
      const current = existing === undefined ? undefined : curYears.length === existing.length && existing.length > 0 ? curYears.join(", ") : String(existing.length);
      const shown = years ? years.join(", ") : String(n);
      add({ section: f.section, label: years ? "Dependents (birth years)" : "Dependents", path: ["filer", "dependents"], current, proposed: current === shown ? current : shown, source: src(f.intake), format: "text", sourceKey: f.path, birthYears: years });
      continue;
    }
    add({ section: f.section, label: f.label, path: toPath(f.path), current: getPath(profile, f.path), proposed, source: src(f.intake), format: f.type, sourceKey: f.path });
  }

  // Prior return as one row -----------------------------------------------------
  const pr = doc.prior_return;
  if (pr) {
    const proposed = strip({
      year: pr.year,
      filingStatus: pr.filingStatus,
      inputs: {
        wages: pr.inputs?.wages, interest: pr.inputs?.interest, ordinaryDividends: pr.inputs?.ordinaryDividends, qualifiedDividends: pr.inputs?.qualifiedDividends,
        shortTermGains: pr.inputs?.shortTermGains, longTermGains: pr.inputs?.longTermGains, otherIncome: pr.inputs?.otherIncome,
        itemized: pr.itemized, isoBargainElement: pr.inputs?.isoBargainElement, amtCreditCarriedIn: pr.inputs?.amtCreditCarriedIn, medicareWages: pr.inputs?.medicareWages,
      },
      reported: {
        agi: pr.agi, taxableIncome: pr.taxableIncome, regularTax: pr.regularTax, amti: pr.amt?.amti, amtExemption: pr.amt?.exemption,
        tentativeMinimumTax: pr.amt?.tentativeMinimumTax, amt: pr.amt?.amt, amtCreditUsed: pr.amt?.creditUsed, niit: pr.niit, additionalMedicare: pr.additionalMedicare, totalTax: pr.totalTax,
      },
    }) as PriorReturn;
    const existing = (profile.returns ?? []).find((r) => r.year === pr.year);
    add({ section: "prior_return", label: `${pr.year} return, for calibration`, path: ["returns"], id: `returns.${pr.year}`, current: existing, proposed, format: "priorReturn", source: src("prior_return"), sourceKey: `returns.${pr.year}` });
  }

  // Equity ------------------------------------------------------------------------
  const eq = doc.equity;
  if (eq) {
    if (profile.equity.companies.length === 0 && (eq.company !== undefined || eq.sharePrice !== undefined)) {
      const sp = typeof eq.sharePrice === "number" ? eq.sharePrice : eq.sharePrice?.value;
      const company = strip({ id: "c1", name: eq.company ?? "Company", sharePrice: sp ?? 0, sharePriceAsOf: typeof eq.sharePrice === "object" ? eq.sharePrice?.asOf : undefined }) as Company;
      add({ section: "equity", label: "Company", path: ["equity", "companies"], current: undefined, proposed: [company], format: "companies", source: src("equity.sharePrice"), sourceKey: "companies.c1.sharePrice" });
    }
    if (eq.grants) {
      const byName = new Map(profile.equity.grants.map((g, i) => [g.name, { grant: g, index: i }]));
      const taken = profile.equity.grants.map((g) => g.id);
      let added = 0;
      eq.grants.forEach((g, i) => {
        const hit = byName.get(g.name);
        const id = hit?.grant.id ?? newId("g", taken);
        if (!hit) taken.push(id);
        const proposed = toGrant(g, id, hit?.grant.company ?? profile.equity.companies[0]?.id ?? "c1", doc.as_of);
        const index = hit ? hit.index : profile.equity.grants.length + added++;
        add({ section: "equity", label: `Grant: ${g.name}`, path: ["equity", "grants", index], id: `grants.${id}`, current: hit?.grant, proposed, format: "grant", source: src(`equity.grants[${i}]`), sourceKey: `grants.${id}`, intakeKey: `equity.grants[${i}]` });
      });
    }
    if (eq.holdings) {
      const taken: string[] = [];
      const proposed: Holding[] = eq.holdings.map((h) => {
        const id = newId("h", taken);
        taken.push(id);
        return strip({ id, lot: h.lot, owner: h.owner, quantity: h.quantity, acquired: h.acquired, via: h.via, costBasis: h.costBasis, amtBasis: h.amtBasis, grantDate: h.grantDate }) as Holding;
      });
      const current = profile.equity.holdings?.length ? profile.equity.holdings : undefined;
      const unchanged = current && same(current.map(({ id: _id, ...h }) => h), proposed.map(({ id: _id, ...h }) => h));
      add({ section: "equity", label: `Holdings (${proposed.length} lot${proposed.length === 1 ? "" : "s"})`, path: ["equity", "holdings"], current, proposed: unchanged ? current : proposed, format: "holdings", source: src("equity.holdings"), sourceKey: "holdings" });
    }
  }

  // Mortgage as one row -------------------------------------------------------------
  if (doc.home?.mortgage) {
    add({ section: "home", label: "Mortgage", path: ["home", "mortgage"], current: profile.home?.mortgage, proposed: strip(doc.home.mortgage), format: "mortgage", source: src("home.mortgage"), sourceKey: "home.mortgage" });
  }

  const unknown = (doc.unknown ?? []).map((p) => ({ path: p, label: fieldByIntake(p)?.label ?? labelFor(p) }));
  return { changes, unknown, questions: doc.questions ?? [], asOf: doc.as_of };
}

/** An intake grant as the profile stores it: the portal's three counts, verbatim. */
export function toGrant(g: IntakeGrant, id: string, companyId?: string, countsAsOf?: string): EquityGrant {
  const type = g.type === "nqso" ? "nso" : g.type;
  const exercised = type === "rsu" ? undefined : g.exercised;
  const granted = g.granted ?? (g.unexercised !== undefined ? g.unexercised + (exercised ?? 0) : 0);
  const out: EquityGrant = {
    id, name: g.name, type, company: companyId, owner: g.owner, grantDate: g.grantDate, granted,
    vestedToDate: g.vested, exercisedToDate: exercised, countsAsOf: g.vested !== undefined ? countsAsOf : undefined,
    strike: type === "rsu" ? undefined : g.strike, expires: g.expires,
    settlement: type === "rsu" && g.trigger === "double" ? "liquidity" : undefined,
  };
  if (Array.isArray(g.vesting)) {
    const byYear: Record<number, number> = {};
    for (const ev of g.vesting) {
      const year = ev.year ?? (ev.date ? Number(ev.date.slice(0, 4)) : undefined);
      if (year !== undefined) byYear[year] = (byYear[year] ?? 0) + ev.shares;
    }
    out.vesting = byYear;
  } else if (g.vesting) {
    out.schedule = { start: g.vesting.start, years: g.vesting.years, cliffMonths: g.vesting.cliffMonths, cadence: g.vesting.cadence };
  }
  return strip(out) as EquityGrant;
}

/** Turn accepted changes into profile edits, recording provenance alongside. */
export function changesToEdits(changes: IntakeChange[], profile: Profile): ProfileEdit[] {
  const edits: ProfileEdit[] = [];
  const grantChanges = changes.filter((c) => c.format === "grant");
  if (grantChanges.length) {
    const grants = [...profile.equity.grants];
    for (const c of grantChanges) {
      const idx = c.path[2] as number;
      if (idx < grants.length) grants[idx] = c.proposed as EquityGrant;
      else grants.push(c.proposed as EquityGrant);
    }
    edits.push({ path: ["equity", "grants"], value: grants });
  }
  const returnChanges = changes.filter((c) => c.format === "priorReturn");
  if (returnChanges.length) {
    const returns = [...(profile.returns ?? [])];
    for (const c of returnChanges) {
      const r = c.proposed as PriorReturn;
      const i = returns.findIndex((x) => x.year === r.year);
      if (i >= 0) returns[i] = r; else returns.push(r);
    }
    edits.push({ path: ["returns"], value: returns });
  }
  for (const c of changes) {
    if (c.id === "filer.dependents") {
      const existing = profile.filer.dependents ?? [];
      if (c.birthYears) edits.push({ path: ["filer", "dependents"], value: c.birthYears.map((birthYear) => ({ birthYear })) });
      else {
        const n = Number(String(c.proposed).split(",").length && !isNaN(Number(c.proposed)) ? Number(c.proposed) : String(c.proposed).split(",").length);
        edits.push({ path: ["filer", "dependents"], value: existing.length >= n ? existing.slice(0, n) : [...existing, ...Array.from({ length: n - existing.length }, () => ({}))] });
      }
    } else if (c.format !== "grant" && c.format !== "priorReturn") edits.push({ path: c.path, value: c.proposed });
    if (c.source) edits.push({ path: ["sources", c.sourceKey], value: c.source });
  }
  // A spouse needs a salary to exist; create the object when any spouse field arrives.
  if (!profile.people.spouse && changes.some((c) => c.path[0] === "people" && c.path[1] === "spouse") && !changes.some((c) => c.id === "people.spouse.salary")) {
    edits.unshift({ path: ["people", "spouse", "salary"], value: 0 });
  }
  // Grants need a company to price against.
  if (profile.equity.companies.length === 0 && grantChanges.length && !changes.some((c) => c.format === "companies")) {
    edits.unshift({ path: ["equity", "companies"], value: [{ id: "c1", name: "Company", sharePrice: 0 }] });
  }
  return edits;
}

/** The agent's open questions as follow-ups to keep on the profile, tied to the profile path they concern when it can be worked out. */
export function followUpEdits(review: IntakeReview, profile: Profile): ProfileEdit[] {
  const existing = profile.followUps ?? [];
  const taken = existing.map((f) => f.id);
  const grantKeys = new Map(review.changes.filter((c) => c.intakeKey).map((c) => [c.intakeKey!, c.sourceKey]));
  const added = new Date().toISOString().slice(0, 10);
  // Grants that arrived with unvested shares but no schedule will never vest in the plan; say so.
  const scheduleGaps: FollowUp[] = review.changes
    .filter((c) => c.format === "grant")
    .map((c) => c.proposed as EquityGrant)
    .filter((g) => !g.schedule && !g.vesting && g.granted - (g.vestedToDate ?? 0) > 0)
    .map((g) => ({ id: "", text: `${g.name}: ${Math.round(g.granted - (g.vestedToDate ?? 0)).toLocaleString("en-US")} unvested ${g.type === "rsu" ? "units" : "shares"} but no vesting schedule, so none of them vest in the plan. Add the schedule on the grant card.`, about: `grants.${g.id}` }));
  const fresh: FollowUp[] = [...scheduleGaps, ...review.questions.map((q) => ({ id: "", text: q.question, about: q.about ?? undefined }))].map((f) => {
    const id = newId("f", taken);
    taken.push(id);
    let about = f.about;
    if (about && !about.startsWith("grants.")) {
      const m = about.match(/^equity\.grants\[(\d+)\]/);
      if (m) about = grantKeys.get(m[0]) ?? `grants.${m[1]}`;
      else if (/^equity\.holdings/.test(about)) about = "holdings";
      else if (/^home\.mortgage/.test(about)) about = "home.mortgage";
      else if (/^prior_return\.(?!amtCreditCarryforward|capitalLossCarryforward|charitableCarryforward)/.test(about)) about = "returns";
      else about = fieldByIntake(about)?.path ?? about;
    }
    return { id, text: f.text, about, added };
  });
  return fresh.length ? [{ path: ["followUps"], value: [...existing, ...fresh] }] : [];
}

/** Where an intake path lands in the profile, for values the user types in by hand. */
export function profilePathForIntake(path: string): ProfilePath | null {
  const f = fieldByIntake(path);
  return f && f.review !== false ? toPath(f.path) : null;
}

function labelFor(path: string): string {
  return path.replace(/\[(\d+)\]/g, " #$1").replace(/\./g, " › ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
