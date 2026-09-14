import { Document, isMap, isScalar, isSeq, parse, parseDocument } from "yaml";
import type { Charitable, Equity, EquityGrant, FilingStatus, GrantType, Levers, Profile } from "./types.ts";

export const FILING_STATUSES: FilingStatus[] = ["single", "mfj", "mfs", "hoh"];
const GRANT_TYPES: GrantType[] = ["iso", "nso", "rsu"];

/** Version 1 files and the pre-typed-grant shape, still accepted on read. */
interface V1Profile {
  version?: number;
  name?: string;
  filer?: Profile["filer"];
  plan?: Profile["plan"];
  assumptions?: Partial<Profile["assumptions"]>;
  income?: Profile["income"] & { wages?: number };
  people?: Profile["people"];
  deductions?: Omit<Profile["deductions"] & {}, "charitable"> & { charitable?: number | Charitable; propertyTax?: number };
  home?: Profile["home"];
  carryforwards?: Profile["carryforwards"];
  priorReturn?: Profile["priorReturn"];
  equity?: Partial<Equity> & { isoGrants?: { name: string; strike: number; fmv: number; shares: number }[]; amtCreditCarryforward?: number };
  levers?: Partial<Levers> & { isoExercises?: Record<number, number> };
  sources?: Record<string, string>;
}

/** Parse a profile file (v1 or v2) into the current shape and fail loudly on anything the engine cannot work with. */
export function parseProfile(text: string): Profile {
  const raw = parse(text) as V1Profile | null;
  if (!raw || typeof raw !== "object") throw new Error("profile is empty");
  const problems: string[] = [];
  if (raw.version !== 1 && raw.version !== 2) problems.push("version must be 1 or 2");
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
  const deductions: Profile["deductions"] = {
    stateIncomeTax: d.stateIncomeTax,
    charitable: typeof d.charitable === "number" ? { cash: d.charitable } : d.charitable,
    medical: d.medical,
    mortgageInterest: d.mortgageInterest,
  };
  const home: Profile["home"] = { ...(raw.home ?? {}) };
  if (home.propertyTax === undefined && typeof d.propertyTax === "number") home.propertyTax = d.propertyTax;
  const carryforwards: Profile["carryforwards"] = { ...(raw.carryforwards ?? {}) };
  if (carryforwards.amtCredit === undefined && typeof raw.equity?.amtCreditCarryforward === "number") carryforwards.amtCredit = raw.equity.amtCreditCarryforward;

  return {
    version: 2,
    name: typeof raw.name === "string" ? raw.name : undefined,
    filer: raw.filer!,
    plan: raw.plan!,
    assumptions: { inflation: 0.025, wageGrowth: 0, fmvGrowth: 0, ...raw.assumptions },
    people: people!,
    income,
    carryforwards,
    priorReturn: raw.priorReturn,
    equity,
    home,
    deductions,
    levers: normalizeLevers(raw),
    sources: raw.sources,
  };
}

function normalizeEquity(raw: V1Profile, problems: string[]): Equity {
  const e = raw.equity ?? {};
  const grants: EquityGrant[] = [...(e.grants ?? [])];
  if (e.isoGrants) for (const g of e.isoGrants) grants.push({ name: g.name, type: "iso", shares: g.shares, strike: g.strike, fmv: g.fmv, vested: g.shares });
  grants.forEach((g, i) => {
    if (!GRANT_TYPES.includes(g.type)) problems.push(`equity.grants[${i}].type must be one of ${GRANT_TYPES.join(", ")}`);
    if (typeof g.shares !== "number" || g.shares < 0) problems.push(`equity.grants[${i}].shares must be a number`);
    if (g.type !== "rsu" && typeof g.strike !== "number") problems.push(`equity.grants[${i}].strike is required for options`);
    if (g.schedule && !/^\d{4}-\d{2}-\d{2}$/.test(g.schedule.start)) problems.push(`equity.grants[${i}].schedule.start must be YYYY-MM-DD`);
  });
  const sharePrice = e.sharePrice ?? grants.find((g) => g.fmv !== undefined)?.fmv ?? 0;
  return { company: e.company, sharePrice, sharePriceAsOf: e.sharePriceAsOf, grants, holdings: e.holdings };
}

function normalizeLevers(raw: V1Profile): Profile["levers"] {
  const l = raw.levers;
  if (!l) return undefined;
  return { exercises: { iso: { ...(l.isoExercises ?? {}), ...(l.exercises?.iso ?? {}) }, nso: { ...(l.exercises?.nso ?? {}) } } };
}

/** Whether a file predates the current schema (version 1, or the pre-typed-grant keys). */
export function isLegacyProfileText(text: string): boolean {
  const raw = parse(text) as V1Profile | null;
  return !!raw && (raw.version !== 2 || !!raw.equity?.isoGrants || !!raw.levers?.isoExercises);
}

/** Rewrite an old file into the current shape. Comments do not survive a version bump; the structure is re-emitted with fresh ones. */
export function migrateProfileText(text: string): string {
  if (!isLegacyProfileText(text)) return text;
  return stringifyProfile(parseProfile(text));
}

const COMMENTS: Record<string, string> = {
  filer: "single | mfj | mfs | hoh; state is a two-letter code (only WA is modeled so far)",
  plan: "the years on screen",
  assumptions: "inflation indexes brackets after 2026; wageGrowth applies to salaries; fmvGrowth to the share value",
  people: "base salary and bonus per earner; RSU vests and option exercises are added by the engine",
  income: "household investment and other income for the start year",
  carryforwards: "balances entering the first plan year: Form 8801 credit, Schedule D losses, unused charitable gifts",
  priorReturn: "the last filed return, for calibration",
  equity: "sharePrice is per share at the start year; grants are iso | nso | rsu with a vesting schedule or per-year counts",
  home: "the mortgage as a loan; interest and the $750k cap are computed",
  deductions: "charitable by kind; stateIncomeTax; medical",
  levers: "where the sliders start",
  sources: "where each number came from, keyed by path",
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

function stripUndefined<T>(value: T): T {
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
