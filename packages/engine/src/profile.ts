import { isMap, isScalar, isSeq, parse, parseDocument, type Document } from "yaml";
import type { Equity, EquityGrant, FilingStatus, GrantType, Levers, Profile } from "./types.ts";

export const FILING_STATUSES: FilingStatus[] = ["single", "mfj", "mfs", "hoh"];

/** Parse a profile file and fail loudly on anything the engine cannot work with. */
export function parseProfile(text: string): Profile {
  const raw = parse(text) as Partial<Profile> | null;
  if (!raw || typeof raw !== "object") throw new Error("profile is empty");
  const problems: string[] = [];
  if (raw.version !== 1) problems.push("version must be 1");
  if (!raw.filer || !FILING_STATUSES.includes(raw.filer.filingStatus)) problems.push(`filer.filingStatus must be one of ${FILING_STATUSES.join(", ")}`);
  if (!raw.filer?.state) problems.push("filer.state is required");
  if (!raw.plan || !Number.isInteger(raw.plan.startYear) || !Number.isInteger(raw.plan.years) || raw.plan.years < 1) problems.push("plan.startYear and plan.years are required");
  if (!raw.assumptions) problems.push("assumptions is required");
  if (!raw.income || typeof raw.income.wages !== "number") problems.push("income.wages is required");
  const equity = normalizeEquity(raw as LegacyProfile, problems);
  if (problems.length) throw new Error("profile problems:\n - " + problems.join("\n - "));
  return {
    version: 1,
    name: typeof raw.name === "string" ? raw.name : undefined,
    filer: raw.filer!,
    plan: raw.plan!,
    assumptions: { inflation: 0.025, wageGrowth: 0, fmvGrowth: 0, ...raw.assumptions },
    income: raw.income!,
    deductions: raw.deductions ?? {},
    equity,
    levers: normalizeLevers(raw as LegacyProfile),
  };
}

const GRANT_TYPES: GrantType[] = ["iso", "nso", "rsu"];

/** Shapes from before grants had types, still accepted on read. */
interface LegacyProfile extends Omit<Partial<Profile>, "equity" | "levers"> {
  equity?: Partial<Equity> & { isoGrants?: { name: string; strike: number; fmv: number; shares: number }[] };
  levers?: Partial<Levers> & { isoExercises?: Record<number, number> };
}

function normalizeEquity(raw: LegacyProfile, problems: string[]): Equity {
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
  return { sharePrice, grants, amtCreditCarryforward: e.amtCreditCarryforward };
}

function normalizeLevers(raw: LegacyProfile): Profile["levers"] {
  const l = raw.levers;
  if (!l) return undefined;
  return { exercises: { iso: { ...(l.isoExercises ?? {}), ...(l.exercises?.iso ?? {}) }, nso: { ...(l.exercises?.nso ?? {}) } } };
}

/** Whether a profile file still uses the pre-grant-type keys. */
export function hasLegacyEquity(text: string): boolean {
  const raw = parse(text) as LegacyProfile | null;
  return !!(raw?.equity?.isoGrants || raw?.levers?.isoExercises);
}

/** Rewrite legacy keys into the current shape, keeping everything else (and comments) intact. */
export function migrateProfileText(text: string): string {
  if (!hasLegacyEquity(text)) return text;
  const p = parseProfile(text);
  const edits: ProfileEdit[] = [
    { path: ["equity", "isoGrants"], value: undefined },
    { path: ["equity", "sharePrice"], value: p.equity.sharePrice },
    { path: ["equity", "grants"], value: p.equity.grants.map((g) => ({ ...g, fmv: undefined })) },
    { path: ["levers", "isoExercises"], value: undefined },
  ];
  if (p.levers) edits.push({ path: ["levers", "exercises"], value: p.levers.exercises });
  return editProfileText(text, edits);
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
    else doc.setIn(resolved, typeof value === "object" && value !== null ? doc.createNode(value) : value);
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
