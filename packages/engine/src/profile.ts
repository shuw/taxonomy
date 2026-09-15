import { Document, isMap, isScalar, isSeq, parse, parseDocument } from "yaml";
import { newId } from "./equity.ts";
import { eventsFromLevers } from "./events.ts";
import type { Charitable, Company, Dependent, EquityGrant, FilingStatus, GrantType, Holding, PriorReturn, Profile, Source, Scenario } from "./types.ts";

/** The per-year lever table older files stored directly: a share count per year. */
type LegacyLevers = { exercises: { iso: Record<number, number>; nso: Record<number, number> } };

export const FILING_STATUSES: FilingStatus[] = ["single", "mfj", "mfs", "hoh"];
const GRANT_TYPES: GrantType[] = ["iso", "nso", "rsu"];
export const CURRENT_VERSION = 3;

/* Older shapes, still accepted on read ------------------------------------------------- */

interface V2Grant { name: string; type: GrantType; owner?: "self" | "spouse"; grantDate?: string; granted?: number; shares: number; strike?: number; fmv?: number; vested?: number; vesting?: Record<number, number>; schedule?: EquityGrant["schedule"]; expires?: string; id?: string }
interface V2Holding { id?: string; lot: string; owner?: "self" | "spouse"; quantity: number; acquired: string; via: Holding["via"]; costBasis: number; amtBasis?: number; company?: string }

interface RawProfile {
  version?: number;
  name?: string;
  filer?: { filingStatus: FilingStatus; state: string; dependents?: number | Dependent[] };
  plan?: Profile["plan"];
  assumptions?: Partial<Profile["assumptions"]>;
  income?: Profile["income"] & { wages?: number };
  people?: Profile["people"];
  deductions?: { stateIncomeTax?: number; charitable?: number | Charitable; medical?: number; mortgageInterest?: number; propertyTax?: number };
  home?: Profile["home"];
  carryforwards?: Profile["carryforwards"];
  priorReturn?: PriorReturn;
  returns?: PriorReturn[];
  equity?: {
    company?: string; sharePrice?: number; sharePriceAsOf?: string;
    companies?: Company[];
    grants?: (V2Grant | EquityGrant)[];
    holdings?: V2Holding[];
    isoGrants?: { name: string; strike: number; fmv: number; shares: number }[];
    amtCreditCarryforward?: number;
  };
  levers?: Partial<LegacyLevers> & { isoExercises?: Record<number, number> };
  scenarios?: Record<string, Partial<LegacyLevers> & Partial<Scenario>>;
  activeScenario?: string;
  timeline?: Profile["timeline"];
  sources?: Record<string, Source>;
  followUps?: Profile["followUps"];
}

/** Parse a profile file of any version into the current shape; fail loudly on anything the engine cannot work with. */
export function parseProfile(text: string): Profile {
  const raw = parse(text) as RawProfile | null;
  if (!raw || typeof raw !== "object") throw new Error("profile is empty");
  const problems: string[] = [];
  if (![1, 2, 3].includes(raw.version as number)) problems.push("version must be 1, 2 or 3");
  if (!raw.filer || !FILING_STATUSES.includes(raw.filer.filingStatus)) problems.push(`filer.filingStatus must be one of ${FILING_STATUSES.join(", ")}`);
  if (!raw.filer?.state) problems.push("filer.state is required");
  if (!raw.plan || !Number.isInteger(raw.plan.startYear) || !Number.isInteger(raw.plan.years) || raw.plan.years < 1) problems.push("plan.startYear and plan.years are required");
  if (!raw.assumptions) problems.push("assumptions is required");

  const people = raw.people ?? (typeof raw.income?.wages === "number" ? { self: { salary: raw.income.wages } } : undefined);
  if (!people?.self || typeof people.self.salary !== "number") problems.push("people.self.salary is required");

  const equity = normalizeEquity(raw, problems);
  if (problems.length) throw new Error("profile problems:\n - " + problems.join("\n - "));

  const { wages: _wages, ...income } = raw.income ?? {};
  const d = raw.deductions ?? {};
  const home: Profile["home"] = { ...(raw.home ?? {}) };
  if (home.propertyTax === undefined && typeof d.propertyTax === "number") home.propertyTax = d.propertyTax;
  if (home.mortgageInterest === undefined && typeof d.mortgageInterest === "number") home.mortgageInterest = d.mortgageInterest;
  const carryforwards: Profile["carryforwards"] = { ...(raw.carryforwards ?? {}) };
  if (carryforwards.amtCredit === undefined && typeof raw.equity?.amtCreditCarryforward === "number") carryforwards.amtCredit = raw.equity.amtCreditCarryforward;
  const dependentsRaw = raw.filer!.dependents;
  const dependents = normalizeDependents(dependentsRaw);
  const returns = raw.returns ?? (raw.priorReturn ? [raw.priorReturn] : undefined);

  let scenarios: Record<string, Scenario> | undefined;
  if (raw.scenarios) scenarios = Object.fromEntries(Object.entries(raw.scenarios).map(([k, v]) => [k, normalizeScenario(v)]));
  else if (raw.levers) scenarios = { default: { events: eventsFromLevers(normalizeLevers(raw.levers)) } };

  return {
    version: 3,
    name: typeof raw.name === "string" ? raw.name : undefined,
    filer: { filingStatus: raw.filer!.filingStatus, state: raw.filer!.state, dependents },
    plan: raw.plan!,
    assumptions: { inflation: 0.025, wageGrowth: 0, fmvGrowth: 0, ...raw.assumptions, state: stateSwitches(raw.assumptions?.state) },
    people: people!,
    income,
    carryforwards,
    returns,
    equity,
    home,
    deductions: { stateIncomeTax: d.stateIncomeTax, charitable: typeof d.charitable === "number" ? { cash: d.charitable } : d.charitable, medical: d.medical },
    timeline: raw.timeline,
    scenarios,
    activeScenario: raw.activeScenario ?? (scenarios ? Object.keys(scenarios)[0] : undefined),
    sources: rekeySources(raw.sources, equity, raw.equity?.isoGrants?.length ?? 0),
    followUps: raw.followUps,
  };
}

function normalizeLevers(l: NonNullable<RawProfile["levers"]>): LegacyLevers {
  return { exercises: { iso: { ...(l.isoExercises ?? {}), ...(l.exercises?.iso ?? {}) }, nso: { ...(l.exercises?.nso ?? {}) } } };
}

/** A scenario is a list of events; older files stored the per-year lever table instead. */
function normalizeScenario(raw: Partial<LegacyLevers> & Partial<Scenario> | null | undefined): Scenario {
  if (raw && Array.isArray(raw.events)) return { events: raw.events };
  if (raw && raw.exercises) return { events: eventsFromLevers(normalizeLevers(raw)) };
  return { events: [] };
}

function normalizeEquity(raw: RawProfile, problems: string[]): Profile["equity"] {
  const e = raw.equity ?? {};
  const companies: Company[] = [...(e.companies ?? [])];
  const legacyPrice = e.sharePrice ?? e.isoGrants?.[0]?.fmv;
  if (companies.length === 0 && (legacyPrice !== undefined || (e.grants?.length ?? 0) > 0 || (e.isoGrants?.length ?? 0) > 0)) {
    companies.push({ id: "c1", name: e.company ?? "Company", sharePrice: legacyPrice ?? 0, sharePriceAsOf: e.sharePriceAsOf });
  }
  const ids: string[] = [];
  const grants: EquityGrant[] = [];
  const pushGrant = (g: EquityGrant) => { ids.push(g.id); grants.push(g); };
  for (const g of e.isoGrants ?? []) {
    pushGrant({ id: newId("g", ids), name: g.name, type: "iso", granted: g.shares, vestedToDate: g.shares, exercisedToDate: 0, strike: g.strike });
  }
  for (const g of e.grants ?? []) {
    if ("granted" in g && typeof g.granted === "number" && !("shares" in g)) {
      pushGrant({ ...(g as EquityGrant), id: (g as EquityGrant).id ?? newId("g", ids) });
      continue;
    }
    const v2 = g as V2Grant;
    const granted = v2.granted ?? v2.shares;
    const exercised = v2.type === "rsu" ? 0 : Math.max(0, granted - v2.shares);
    const vestedToDate = v2.vested === undefined ? undefined : v2.type === "rsu" ? v2.vested : v2.vested + exercised;
    pushGrant(stripUndefined({
      id: v2.id ?? newId("g", ids), name: v2.name, type: v2.type, owner: v2.owner, grantDate: v2.grantDate,
      granted, vestedToDate, exercisedToDate: exercised || undefined, strike: v2.type === "rsu" ? undefined : v2.strike,
      vesting: v2.vesting, schedule: v2.schedule, expires: v2.expires,
    }));
  }
  grants.forEach((g, i) => {
    if (!GRANT_TYPES.includes(g.type)) problems.push(`equity.grants[${i}].type must be one of ${GRANT_TYPES.join(", ")}`);
    if (typeof g.granted !== "number" || g.granted < 0) problems.push(`equity.grants[${i}].granted must be a number`);
    if (g.type !== "rsu" && typeof g.strike !== "number") problems.push(`equity.grants[${i}].strike is required for options`);
    if (g.schedule && !/^\d{4}-\d{2}-\d{2}$/.test(g.schedule.start)) problems.push(`equity.grants[${i}].schedule.start must be YYYY-MM-DD`);
    if (g.company && !companies.some((c) => c.id === g.company)) problems.push(`equity.grants[${i}].company "${g.company}" is not in equity.companies`);
  });
  const hids: string[] = [];
  const holdings = e.holdings?.map((h) => { const id = h.id ?? newId("h", hids); hids.push(id); return { ...h, id }; });
  return { companies, grants, holdings };
}

/** Dependents as a list of entries, from a list, a count, or a typed "2019, 2022". */
function normalizeDependents(raw: unknown): Dependent[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) return raw.map((d) => (typeof d === "number" ? { birthYear: d } : d && typeof d === "object" ? (d as Dependent) : {}));
  if (typeof raw === "number") return Array.from({ length: Math.max(0, Math.round(raw)) }, () => ({}));
  if (typeof raw === "string") return raw.split(/[,\s]+/).filter(Boolean).map((t) => (/^\d{4}$/.test(t) ? { birthYear: Number(t) } : {}));
  return undefined;
}

/** Sources keyed by grant or holding index move to ids, so reordering never orphans them. Legacy `isoGrants` came first in the merged list, so `grants.N` sits after them. */
function rekeySources(sources: Record<string, Source> | undefined, equity: Profile["equity"], legacyIsoCount = 0): Record<string, Source> | undefined {
  if (!sources) return undefined;
  const out: Record<string, Source> = {};
  for (const [k, v] of Object.entries(sources)) {
    const m = k.match(/^equity\.grants\.(\d+)$/);
    const h = k.match(/^equity\.holdings$/);
    const idx = m ? Number(m[1]) + legacyIsoCount : -1;
    if (m && equity.grants[idx]) out[`grants.${equity.grants[idx]!.id}`] = v;
    else if (h) out["holdings"] = v;
    else if (k === "equity.sharePrice" && equity.companies[0]) out[`companies.${equity.companies[0].id}.sharePrice`] = v;
    else out[k] = v;
  }
  return out;
}

/** Whether a file predates the current schema. */
export function isLegacyProfileText(text: string): boolean {
  const raw = parse(text) as RawProfile | null;
  return !!raw && raw.version !== CURRENT_VERSION;
}

/** Rewrite an old file into the current shape. Comments do not survive a version bump; the structure is re-emitted with fresh ones. */
export function migrateProfileText(text: string): string {
  if (!isLegacyProfileText(text)) return text;
  return stringifyProfile(parseProfile(text));
}

const COMMENTS: Record<string, string> = {
  filer: "single | mfj | mfs | hoh; state is a two-letter code (only WA is modeled so far); dependents by birth year",
  plan: "the years on screen",
  assumptions: "inflation indexes brackets after 2026; wageGrowth applies to salaries; fmvGrowth to share values; bracketRateDelta shifts every bracket rate",
  people: "base salary and bonus per earner; RSU vests and option exercises are added by the engine",
  income: "household investment and other income for the start year",
  carryforwards: "balances entering the first plan year: Form 8801 credit, Schedule D losses, unused charitable gifts",
  returns: "filed returns; the newest is used for calibration",
  equity: "companies with a share price; grants by the portal's three counts (granted, vestedToDate, exercisedToDate); holdings are lots you own",
  home: "the mortgage as a loan; interest and the $750k cap are computed",
  deductions: "charitable by kind; stateIncomeTax; medical",
  timeline: "dated changes to any value above, in force from that year on: { year, path, value }",
  scenarios: "named lists of decisions on the timeline: exercise, sell and liquidity events; activeScenario picks one",
  sources: "where each number came from, keyed by path (grants and holdings by id)",
  followUps: "things your intake agent asked you to confirm; resolved ones stay for the record",
};

/** Emit a profile as YAML with a comment on each top-level section. */
export function stringifyProfile(profile: Profile): string {
  const doc = new Document(stripUndefined(profile));
  const top = doc.contents;
  if (isMap(top)) {
    for (const pair of top.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      if (COMMENTS[key] && isScalar(pair.key)) pair.key.commentBefore = " " + COMMENTS[key];
    }
    top.items.forEach((pair, i) => { if (i > 0 && isScalar(pair.key)) pair.key.spaceBefore = true; });
  }
  doc.commentBefore = " Taxonomy profile. Amounts are annual dollars for plan.startYear unless noted.";
  return doc.toString({ lineWidth: 0 });
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (v !== undefined) out[k] = stripUndefined(v);
    return out as T;
  }
  return value;
}

export type ProfilePath = (string | number)[];
export interface ProfileEdit { path: ProfilePath; value: unknown }

/**
 * Apply edits to the YAML text of a profile, keeping comments and ordering intact so the
 * file stays pleasant to read and edit by hand. `undefined` deletes the key.
 */
export function editProfileText(text: string, edits: ProfileEdit[]): string {
  const doc = parseDocument(text);
  for (const { path, value } of edits) {
    const resolved = resolvePath(doc, path);
    if (value === undefined) doc.deleteIn(resolved);
    else doc.setIn(resolved, typeof value === "object" && value !== null ? doc.createNode(stripUndefined(value)) : value);
  }
  return doc.toString({ lineWidth: 0 });
}

/**
 * YAML tells `2026:` and `"2026":` apart; we do not want two keys for one year. Where a map
 * already has a key that prints the same as a path segment, use that existing key.
 */
function resolvePath(doc: Document, path: ProfilePath): ProfilePath {
  const out: ProfilePath = [];
  let node: unknown = doc.contents;
  for (const seg of path) {
    let key: string | number = seg;
    if (isMap(node)) {
      const pair = node.items.find((p) => String(isScalar(p.key) ? p.key.value : p.key) === String(seg));
      if (pair) {
        const k = isScalar(pair.key) ? pair.key.value : pair.key;
        if (typeof k === "string" || typeof k === "number") key = k;
        node = pair.value;
      } else node = undefined;
    } else if (isSeq(node) && typeof seg === "number") {
      node = node.items[seg];
    } else node = undefined;
    out.push(key);
  }
  return out;
}

/** Older files carried the millionaires' tax as a proposal with its own rate and threshold; it is now a plain switch. */
function stateSwitches(raw: unknown): Profile["assumptions"]["state"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { waHighEarnerTax, ...rest } = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  if (waHighEarnerTax && typeof waHighEarnerTax === "object" && "enabled" in waHighEarnerTax && out.waMillionairesTax === undefined && (waHighEarnerTax as { enabled: unknown }).enabled === false) out.waMillionairesTax = false;
  return Object.keys(out).length ? (out as Profile["assumptions"]["state"]) : undefined;
}
