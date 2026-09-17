import type { Profile, Source } from "./types.ts";
import type { ProfileEdit } from "./profile.ts";
import { getPath } from "./timeline.ts";

/** A source as one line: the document, when it was read, and any note. */
export function describeSource(s: Source): string {
  return typeof s === "string" ? s : `${s.doc}${s.asOf ? ` (${s.asOf})` : ""}${s.note ? ` · ${s.note}` : ""}`;
}

/** The `sources` key a profile path is recorded under: scalars by path, grants and holdings by id. */
export function sourceKeyFor(profile: Profile, path: (string | number)[]): string | undefined {
  const [a, b, c] = path;
  if (a === "equity" && b === "grants" && typeof c === "number") { const id = profile.equity.grants[c]?.id; return id ? `grants.${id}` : undefined; }
  if (a === "equity" && b === "holdings") return "holdings";
  if (a === "equity" && b === "companies" && typeof c === "number") { const id = profile.equity.companies[c]?.id; return id && path.length > 3 ? `companies.${id}.${path.slice(3).join(".")}` : undefined; }
  return path.join(".");
}

/**
 * When a value with a recorded source is changed by hand, the source must say so. For each edit
 * that changes something with a source, one more edit rewrites that source to "you", today, with
 * the old provenance kept in the note. Edits to the bookkeeping lists carry no source and are skipped.
 */
export function sourcesAfterEdit(profile: Profile, edits: ProfileEdit[], today = new Date().toISOString().slice(0, 10)): ProfileEdit[] {
  const out: ProfileEdit[] = [];
  const done = new Set<string>();
  for (const e of edits) {
    const head = String(e.path[0] ?? "");
    if (["sources", "scenarios", "activeScenario", "timeline", "followUps", "pending", "pendingIntake", "returns"].includes(head)) continue;
    const key = sourceKeyFor(profile, e.path);
    if (!key || done.has(key)) continue;
    const old = profile.sources?.[key];
    if (!old) continue;
    if (JSON.stringify(getPath(profile, e.path.join("."))) === JSON.stringify(e.value)) continue;
    done.add(key);
    out.push({ path: ["sources", key], value: { doc: "you", asOf: today, note: `was: ${describeSource(old)}` } });
  }
  return out;
}
