import { fieldByPath, type FieldDef } from "./fields.ts";
import type { PendingChange, PendingIntake, Profile, ScenarioEvent, TimelineEntry } from "./types.ts";
import { int } from "./ledger.ts";

/** One saved change to a profile: when, who, and what it did in plain words. */
export interface HistoryEntry {
  at: string;
  /** "you" for the app, otherwise the agent client's name. */
  actor: string;
  lines: string[];
  /** The file as it was before this change, for restoring. */
  before?: string;
}

const money = (n: number) => `$${int(n)}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const count = int;

function fmt(def: FieldDef | undefined, v: unknown): string {
  if (v === undefined || v === null || v === "") return "unset";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number") return def?.type === "usd" ? money(v) : def?.type === "pct" ? pct(v) : count(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function scalar(path: string, from: unknown, to: unknown): string {
  const def = fieldByPath(path.replace(/^equity\.companies\.\d+\./, "equity.companies.0."));
  const label = def?.label ?? path;
  if (from === undefined) return `${label}: ${fmt(def, to)}`;
  if (to === undefined) return `${label} cleared (was ${fmt(def, from)})`;
  return `${label}: ${fmt(def, from)} → ${fmt(def, to)}`;
}

const event = (e: ScenarioEvent): string =>
  e.kind === "exercise" ? `exercise ${count(e.shares)} ${e.type.toUpperCase()} shares in ${e.year}`
  : e.kind === "sell" ? `sell ${count(e.shares)} shares in ${e.year}`
  : e.kind === "give" ? `give ${money(e.amount)} ${e.how === "stock" ? "in shares" : e.how === "daf" ? "to a donor-advised fund" : "cash"} in ${e.year}`
  : `liquidity event in ${e.year}`;

const dated = (t: TimelineEntry): string => scalar(t.path, undefined, t.value) + (t.until === undefined ? ` from ${t.year}` : t.until === t.year ? ` in ${t.year} only` : ` ${t.year}–${t.until}`);

const proposal = (p: PendingChange): string => scalar(p.path, undefined, p.value) + (p.from ? ` from ${p.from}` : "");

const doc = (d: PendingIntake): string => `document${d.sections?.length ? ` (${d.sections.join(", ").replace("prior_return", "last return")})` : ""}`;

/** Deep diff of plain data as (path, from, to) leaves, arrays included by index. */
function leaves(a: unknown, b: unknown, path: string, out: { path: string; from: unknown; to: unknown }[]): void {
  if (a === b) return;
  const plain = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
  // A block that appears or disappears whole is walked field by field, so each value gets its own line.
  if (plain(a) && b === undefined) a = a, b = {};
  if (plain(b) && a === undefined) a = {};
  const objA = a !== null && typeof a === "object", objB = b !== null && typeof b === "object";
  if (!objA || !objB || Array.isArray(a) !== Array.isArray(b)) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, from: a, to: b }); return; }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) leaves((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out);
}

function byId<T extends { id: string }>(list: T[] | undefined): Map<string, T> { return new Map((list ?? []).map((x) => [x.id, x])); }

/** What changed between two profiles, as lines a person can read. Empty when nothing did. */
export function describeChanges(before: Profile | null, after: Profile): string[] {
  if (!before) return [`Profile "${after.name ?? ""}" created`];
  const lines: string[] = [];

  // Decisions, by scenario and event id.
  const scA = before.scenarios ?? {}, scB = after.scenarios ?? {};
  for (const name of new Set([...Object.keys(scA), ...Object.keys(scB)])) {
    const a = scA[name], b = scB[name];
    const tag = Object.keys(scB).length > 1 || Object.keys(scA).length > 1 ? ` (scenario "${name}")` : "";
    if (!a && b) { lines.push(`Scenario "${name}" created${b.note ? `: ${b.note}` : ""}${b.events.length ? `, with ${b.events.map(event).join("; ")}` : ""}`); continue; }
    if (a && !b) { lines.push(`Scenario "${name}" deleted`); continue; }
    const ea = byId(a!.events), eb = byId(b!.events);
    for (const [id, e] of eb) {
      const prev = ea.get(id);
      if (!prev) lines.push(`Added ${event(e)}${tag}`);
      else if (JSON.stringify(prev) !== JSON.stringify(e)) lines.push(`Changed ${event(prev)} → ${event(e)}${tag}`);
    }
    for (const [id, e] of ea) if (!eb.has(id)) lines.push(`Removed ${event(e)}${tag}`);
  }
  if (before.activeScenario !== after.activeScenario && after.activeScenario) lines.push(`Switched to scenario "${after.activeScenario}"`);

  // Dated changes.
  const ta = byId(before.timeline?.map((t, i) => ({ ...t, id: t.id ?? String(i) }))), tb = byId(after.timeline?.map((t, i) => ({ ...t, id: t.id ?? String(i) })));
  for (const [id, t] of tb) { const prev = ta.get(id); if (!prev) lines.push(`Dated change: ${dated(t)}`); else if (JSON.stringify(prev) !== JSON.stringify(t)) lines.push(`Dated change edited: ${dated(t)}`); }
  for (const [id, t] of ta) if (!tb.has(id)) lines.push(`Dated change removed: ${dated(t)}`);

  // Proposals and documents from an agent.
  const pa = byId(before.pending), pb = byId(after.pending);
  for (const [id, p] of pb) if (!pa.has(id)) lines.push(`Proposed ${proposal(p)}${p.source ? ` (${p.source})` : ""}`);
  for (const [id, p] of pa) if (!pb.has(id)) lines.push(`Proposal resolved: ${proposal(p)}`);
  const da = byId(before.pendingIntake), db = byId(after.pendingIntake);
  for (const [id, d] of db) if (!da.has(id)) lines.push(`Sent a ${doc(d)} for review`);
  for (const [id, d] of da) if (!db.has(id)) lines.push(`Reviewed a ${doc(d)}`);
  const fa = byId(before.followUps), fb = byId(after.followUps);
  for (const [id, f] of fb) { const prev = fa.get(id); if (!prev) lines.push(`${f.kind === "missing" ? "Question" : "Note from Claude"}: ${f.text}`); else if (!prev.resolved && f.resolved) lines.push(`Answered: ${f.text}`); }

  // Equity items by id.
  const items: [string, (x: { id: string; name?: string; lot?: string }) => string, Map<string, { id: string }>, Map<string, { id: string }>][] = [
    ["Company", (c) => c.name ?? c.id, byId(before.equity.companies), byId(after.equity.companies)],
    ["Grant", (g) => g.name ?? g.id, byId(before.equity.grants), byId(after.equity.grants)],
    ["Holding", (h) => h.lot ?? h.id, byId(before.equity.holdings), byId(after.equity.holdings)],
  ];
  for (const [kind, label, a, b] of items) {
    for (const [id, x] of b) {
      const prev = a.get(id);
      if (!prev) { lines.push(`${kind} added: ${label(x)}`); continue; }
      if (JSON.stringify(prev) === JSON.stringify(x)) continue;
      // Which fields moved, with the registry's label for company fields.
      const fields: { path: string; from: unknown; to: unknown }[] = [];
      leaves(prev, x, kind === "Company" ? "equity.companies.0" : "", fields);
      const parts = fields.filter((f) => !f.path.endsWith("id")).map((f) => kind === "Company" ? scalar(f.path, f.from, f.to) : scalar(f.path, f.from, f.to).replace(/^[^:]*\./, ""));
      lines.push(`${label(x)}: ${parts.join("; ") || "changed"}`);
    }
    for (const [id, x] of a) if (!b.has(id)) lines.push(`${kind} removed: ${label(x)}`);
  }
  const ra = new Map((before.returns ?? []).map((r) => [r.year, r])), rb = new Map((after.returns ?? []).map((r) => [r.year, r]));
  for (const [y, r] of rb) { const prev = ra.get(y); if (!prev) lines.push(`${y} return added`); else if (JSON.stringify(prev) !== JSON.stringify(r)) lines.push(`${y} return changed`); }
  for (const y of ra.keys()) if (!rb.has(y)) lines.push(`${y} return removed`);

  // Everything else as scalars, with the registry's labels; sections handled above are skipped, sources are noise.
  const skip = /^(scenarios|activeScenario|timeline|pending|pendingIntake|followUps|sources|equity\.(companies|grants|holdings)|returns|filer\.dependents)(\.|$)/;
  const people = (d: Profile["filer"]["dependents"]) => (d ?? []).map((x) => x.birthYear ?? x.name ?? "?").join(", ") || "none";
  if (JSON.stringify(before?.filer.dependents ?? []) !== JSON.stringify(after.filer.dependents ?? [])) lines.push(before ? `Dependents: ${people(before.filer.dependents)} → ${people(after.filer.dependents)}` : `Dependents: ${people(after.filer.dependents)}`);
  const raw: { path: string; from: unknown; to: unknown }[] = [];
  leaves(before, after, "", raw);
  for (const l of raw) if (!skip.test(l.path)) lines.push(scalar(l.path, l.from, l.to));
  return lines;
}
