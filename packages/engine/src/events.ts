import type { Levers, Profile, Scenario, ScenarioEvent } from "./types.ts";
import { DEFAULT_SCENARIO } from "./timeline.ts";

export function emptyScenario(): Scenario {
  return { events: [] };
}

/** The active scenario, or an empty one. */
export function activeScenario(profile: Profile): Scenario {
  const name = profile.activeScenario ?? DEFAULT_SCENARIO;
  return profile.scenarios?.[name] ?? profile.scenarios?.[DEFAULT_SCENARIO] ?? emptyScenario();
}

/** Company key used when an exercise event names none: the profile's first company. */
export const ANY_COMPANY = "*";

/** Collapse a scenario's events into the per-year lever table the engine computes from. */
export function leversOf(scenario: Scenario | undefined, defaultCompany: string = ANY_COMPANY): Levers {
  const levers: Levers = { exercises: { iso: {}, nso: {} }, exerciseDates: { iso: {}, nso: {} }, sales: {} };
  for (const e of sortedEvents(scenario?.events ?? [])) {
    if (e.kind === "exercise") {
      const c = e.company ?? defaultCompany;
      const year = (levers.exercises[e.type][e.year] ??= {});
      year[c] = (year[c] ?? 0) + e.shares;
      if (e.date) levers.exerciseDates![e.type][e.year] = e.date;
    } else if (e.kind === "sell") {
      (levers.sales![e.year] ??= []).push({ id: e.id, shares: e.shares, date: e.date, price: e.price, lots: e.lots });
    } else if (e.kind === "liquidity") {
      (levers.liquidity ??= {})[e.company ?? "*"] = { year: e.year, price: e.price };
    }
  }
  return levers;
}

/** One exercise event per year and type with shares, for files that stored the lever table directly (a plain number per year). */
export function eventsFromLevers(levers: { exercises: { iso: Record<number, number>; nso: Record<number, number> } }): ScenarioEvent[] {
  const events: ScenarioEvent[] = [];
  for (const type of ["iso", "nso"] as const) {
    for (const [y, shares] of Object.entries(levers.exercises[type] ?? {})) {
      if (shares > 0) events.push({ id: newEventId(events), kind: "exercise", type, year: Number(y), shares });
    }
  }
  return events;
}

/** Shares of a type exercised in a year, across companies. */
export function exercisedTotal(levers: Levers, type: "iso" | "nso", year: number): number {
  return Object.values(levers.exercises[type][year] ?? {}).reduce((s, n) => s + n, 0);
}

export function newEventId(events: ScenarioEvent[]): string {
  const taken = new Set(events.map((e) => e.id));
  for (let n = 1; ; n++) if (!taken.has(`e${n}`)) return `e${n}`;
}

/**
 * Set the ISO or NSO shares exercised in a year: updates the year's exercise event of that type,
 * adds one, or removes it when shares drop to zero. Returns the new event list and the event touched.
 */
export function setExerciseEvent(events: ScenarioEvent[], type: "iso" | "nso", year: number, shares: number, company?: string): { events: ScenarioEvent[]; id: string | null } {
  const n = Math.max(0, Math.round(shares));
  const existing = events.find((e) => e.kind === "exercise" && e.type === type && e.year === year && (company === undefined || (e.company ?? company) === company));
  if (existing) {
    if (n === 0) return { events: events.filter((e) => e.id !== existing.id), id: null };
    return { events: events.map((e) => (e.id === existing.id ? { ...e, shares: n } : e)), id: existing.id };
  }
  if (n === 0) return { events, id: null };
  const id = newEventId(events);
  return { events: [...events, { id, kind: "exercise", type, year, shares: n, ...(company ? { company } : {}) }], id };
}

/** Events in chronological order: by year, then by date within the year, then by insertion. */
export function sortedEvents(events: ScenarioEvent[]): ScenarioEvent[] {
  return [...events].sort((a, b) => a.year - b.year || (a.date ?? "").localeCompare(b.date ?? ""));
}

/** Edits that store a scenario's events in the file, clearing the older lever-table key if the file still has it. */
export function scenarioEdits(name: string, events: ScenarioEvent[]): { path: (string | number)[]; value: unknown }[] {
  return [
    { path: ["scenarios", name, "events"], value: events },
    { path: ["scenarios", name, "exercises"], value: undefined },
  ];
}
