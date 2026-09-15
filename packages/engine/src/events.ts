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

/** Collapse a scenario's events into the per-year lever table the engine computes from. */
export function leversOf(scenario: Scenario | undefined): Levers {
  const levers: Levers = { exercises: { iso: {}, nso: {} } };
  for (const e of scenario?.events ?? []) {
    if (e.kind === "exercise") levers.exercises[e.type][e.year] = (levers.exercises[e.type][e.year] ?? 0) + e.shares;
  }
  return levers;
}

/** One exercise event per year and type with shares, for files that stored the lever table directly. */
export function eventsFromLevers(levers: Levers): ScenarioEvent[] {
  const events: ScenarioEvent[] = [];
  for (const type of ["iso", "nso"] as const) {
    for (const [y, shares] of Object.entries(levers.exercises[type] ?? {})) {
      if (shares > 0) events.push({ id: newEventId(events), kind: "exercise", type, year: Number(y), shares });
    }
  }
  return events;
}

export function newEventId(events: ScenarioEvent[]): string {
  const taken = new Set(events.map((e) => e.id));
  for (let n = 1; ; n++) if (!taken.has(`e${n}`)) return `e${n}`;
}

/**
 * Set the ISO or NSO shares exercised in a year: updates the year's exercise event of that type,
 * adds one, or removes it when shares drop to zero. Returns the new event list and the event touched.
 */
export function setExerciseEvent(events: ScenarioEvent[], type: "iso" | "nso", year: number, shares: number): { events: ScenarioEvent[]; id: string | null } {
  const n = Math.max(0, Math.round(shares));
  const existing = events.find((e) => e.kind === "exercise" && e.type === type && e.year === year);
  if (existing) {
    if (n === 0) return { events: events.filter((e) => e.id !== existing.id), id: null };
    return { events: events.map((e) => (e.id === existing.id ? { ...e, shares: n } : e)), id: existing.id };
  }
  if (n === 0) return { events, id: null };
  const id = newEventId(events);
  return { events: [...events, { id, kind: "exercise", type, year, shares: n }], id };
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
