import { activeScenario, leversOf } from "./events.ts";
import type { Levers, Profile, TimelineEntry } from "./types.ts";

/** Set a dot-path value on a plain object, creating intermediate objects. */
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  if (segs.some((s) => UNSAFE.has(s) || s === "")) throw new Error(`unsafe path "${path}"`);
  let node: Record<string, unknown> = target;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]!;
    const next = node[seg];
    if (next === null || typeof next !== "object") node[seg] = {};
    node = node[seg] as Record<string, unknown>;
  }
  const last = segs[segs.length - 1]!;
  if (value === undefined) delete node[last];
  else node[last] = value;
}

export function getPath(target: unknown, path: string): unknown {
  let node: unknown = target;
  for (const seg of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

/** Deep clone of plain data. */
export const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * The profile as it stands in `year`: every timeline entry dated that year or earlier applied,
 * in date order. Growth assumptions still apply on top from plan.startYear, so a salary set for
 * 2028 is a 2028 figure and grows from there only through the wage growth assumption relative
 * to the plan start (keep timeline values in the dollars of their own year).
 */
export function profileInYear(profile: Profile, year: number): Profile {
  const entries = (profile.timeline ?? []).filter((e) => e.year <= year).sort((a, b) => a.year - b.year);
  if (entries.length === 0) return profile;
  const out = clone(profile) as unknown as Record<string, unknown>;
  for (const e of entries) {
    try { setPath(out, e.path, e.value); } catch { /* an unsafe or malformed path is ignored, not applied */ }
  }
  return out as unknown as Profile;
}

/** Timeline entries that first take effect in `year`, for display. */
export function changesIn(profile: Profile, year: number): TimelineEntry[] {
  return (profile.timeline ?? []).filter((e) => e.year === year);
}

export const DEFAULT_SCENARIO = "default";

export function emptyLevers(): Levers {
  return { exercises: { iso: {}, nso: {} } };
}

/** The lever table of the active scenario, derived from its events. */
export function activeLevers(profile: Profile): Levers {
  return leversOf(activeScenario(profile));
}
