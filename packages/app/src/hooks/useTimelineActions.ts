import { getPath, newEventId, newId, scenarioEdits, setExerciseEvent, sharesToCover, timelineFields, type Levers, type Profile, type ProfileEdit, type ScenarioEvent, type TimelineEntry } from "@taxonomy/engine";
import type { AddKind, FactMarker } from "../components/timeline/types.ts";

interface Deps {
  profile: Profile;
  levers: Levers;
  events: ScenarioEvent[];
  facts: FactMarker[];
  edit: (edits: ProfileEdit[]) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setFocusYear: (year: number) => void;
}

/** Everything the timeline can do to the profile: decisions in the active scenario, dated changes in the timeline. */
export function useTimelineActions({ profile, levers, events, facts, edit, selectedId, setSelectedId, setFocusYear }: Deps) {
  const scenarioName = profile.activeScenario ?? "default";
  const firstCompany = profile.equity.companies[0]?.id;
  const timeline = profile.timeline ?? [];

  const writeEvents = (next: ScenarioEvent[]) => {
    const edits: ProfileEdit[] = [];
    if (!profile.scenarios?.[scenarioName]) edits.push({ path: ["activeScenario"], value: scenarioName });
    edits.push(...scenarioEdits(scenarioName, next));
    edit(edits);
  };
  const select = (id: string | null) => {
    setSelectedId(id);
    const year = events.find((x) => x.id === id)?.year ?? facts.find((f) => f.id === id)?.year;
    if (year !== undefined) setFocusYear(year);
  };
  const change = (id: string, patch: Partial<ScenarioEvent>) => {
    writeEvents(events.map((e) => (e.id === id ? ({ ...e, ...patch } as ScenarioEvent) : e)));
    if (typeof patch.year === "number") setFocusYear(patch.year);
  };
  const add = (what: AddKind, year: number) => {
    if (what.kind === "exercise") {
      const existing = events.find((e) => e.kind === "exercise" && e.type === what.type && e.year === year && (e.company ?? firstCompany) === (what.company ?? firstCompany));
      if (existing) { select(existing.id); return; }
    }
    if (what.kind === "liquidity") {
      const dup = events.find((e) => e.kind === "liquidity");
      if (dup) { change(dup.id, { year }); select(dup.id); return; }
    }
    const id = newEventId(events);
    const event: ScenarioEvent =
      what.kind === "exercise" ? { id, kind: "exercise", type: what.type, year, shares: 0, ...(what.company ? { company: what.company } : {}) }
      : what.kind === "sell" ? { id, kind: "sell", year, shares: 0 }
      : { id, kind: "liquidity", year };
    writeEvents([...events, event]);
    setSelectedId(id);
    setFocusYear(year);
  };
  const remove = (id: string) => { writeEvents(events.filter((e) => e.id !== id)); if (selectedId === id) setSelectedId(null); };
  const sellToCover = (id: string) => {
    const e = events.find((x) => x.id === id);
    if (!e || e.kind !== "sell") return;
    writeEvents(events.map((x) => (x.id === id ? { ...x, shares: sharesToCover(profile, levers, e.year, id), lots: undefined } : x)));
  };
  /** The sweep chart sets a company's ISO count for a year directly. */
  const setIsoShares = (year: number, n: number, company: string) => {
    const r = setExerciseEvent(events, "iso", year, n, profile.equity.companies.length > 1 ? company : undefined);
    writeEvents(r.events);
    if (r.id) setSelectedId(r.id);
  };

  const addFact = (path: string, year: number) => {
    const f = timelineFields().find((x) => x.path === path);
    const current = getPath(profile, path);
    const value = current !== undefined ? current : f?.type === "bool" ? true : f?.type === "enum" ? f.enum?.[0] : 0;
    const id = newId("t", timeline.map((t) => t.id ?? ""));
    edit([{ path: ["timeline"], value: [...timeline, { id, year, path, value }] }]);
    setSelectedId(id);
    setFocusYear(year);
  };
  const changeFact = (i: number, entry: TimelineEntry) => { edit([{ path: ["timeline"], value: timeline.map((t, j) => (j === i ? entry : t)) }]); setFocusYear(entry.year); };
  const removeFact = (i: number) => { edit([{ path: ["timeline"], value: timeline.filter((_, j) => j !== i) }]); setSelectedId(null); };

  return { select, add, change, remove, sellToCover, setIsoShares, addFact, changeFact, removeFact };
}
