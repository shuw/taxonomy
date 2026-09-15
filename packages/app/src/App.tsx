import { useEffect, useMemo, useState } from "react";
import { ProfileIdContext, usePersisted } from "./persist.ts";
import { FactsModal, isFactTab, type FactTab } from "./components/FactsModal.tsx";
import { activeScenario, amtCrossover, companiesWithGrants, creditRecovery, exercisedIn, getPath, newEventId, planYears, resolveLevers, runPlan, scenarioEdits, setExerciseEvent, sharesToCover, sweepIsoExercise, statusName, timelineFields, type Levers, type PlanResult, type Profile, type ProfileEdit, type ScenarioEvent, type TimelineEntry } from "@taxonomy/engine";
import { EventTimeline, factMarkers, type AddKind } from "./components/EventTimeline.tsx";
import { Segmented } from "./components/fields.tsx";
import { api, type ProfileSummary } from "./api.ts";
import { usdCompact } from "./format.ts";
import { useProfile, useProfileList } from "./useProfile.ts";
import { Hero } from "./components/Hero.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { ScenarioBar } from "./components/ScenarioBar.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { ProfileSwitcher } from "./components/ProfileSwitcher.tsx";
import { TaxStrip, CreditStrip, CashStrip } from "./components/Strips.tsx";
import { SweepChart } from "./components/SweepChart.tsx";
import { LedgerTable } from "./components/LedgerTable.tsx";
import { ExplainPanel } from "./components/ExplainPanel.tsx";
import { Mark, Wordmark } from "./components/Mark.tsx";
import { IntakeModal } from "./components/IntakeModal.tsx";
import { CalibrationCard } from "./components/CalibrationCard.tsx";
import { CreditRecoveryView } from "./components/CreditRecovery.tsx";
import { FollowUps } from "./components/FollowUps.tsx";

export interface Pinned { levers: Levers; plan: PlanResult; }
export interface Selection { year: number; id: string; }

const STORAGE_KEY = "taxonomy.profile";

function rememberedId(): string | null {
  const fromUrl = new URLSearchParams(location.search).get("p");
  if (fromUrl) return fromUrl;
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

/** Dialog state lives in the hash so a refresh lands you where you were. */
function setHash(name: string | null) {
  const url = new URL(location.href);
  url.hash = name ? `#${name}` : "";
  history.replaceState(null, "", url);
}

function remember(id: string) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  const url = new URL(location.href);
  url.searchParams.set("p", id);
  history.replaceState(null, "", url);
}

export function App() {
  const { list, refresh } = useProfileList();
  const [wantedId, setWantedId] = useState<string | null>(rememberedId);
  const [creating, setCreatingState] = useState(() => location.hash === "#new");
  const setCreating = (v: boolean) => { setCreatingState(v); setHash(v ? "new" : null); };

  const currentId = useMemo(() => {
    if (!list || list.length === 0) return null;
    return list.some((p) => p.id === wantedId) ? wantedId : list[0]!.id;
  }, [list, wantedId]);
  useEffect(() => { if (currentId) remember(currentId); }, [currentId]);

  const store = useProfile(currentId);
  const needIntake = list !== null && (list.length === 0 || creating);

  const switchTo = (id: string) => { setWantedId(id); setCreating(false); };
  const create = async (name: string, text: string) => {
    const created = await api.create(name, text);
    await refresh();
    switchTo(created.id);
  };

  if (list === null) return <div className="empty">Loading profiles…</div>;
  if (needIntake) return <IntakeModal mode="create" onCreate={create} onClose={list.length > 0 ? () => setCreating(false) : undefined} />;
  const file = store.file;
  if (!file || file.id !== currentId) return <div className="empty">Loading profile…</div>;
  if (!file.profile) return <div className="empty"><div className="error">{file.error}</div></div>;

  const currentName = file.profile.name?.trim() || file.id;
  const actions = {
    onSwitch: switchTo,
    onNew: () => setCreating(true),
    onDuplicate: async () => {
      const created = await api.create(`${currentName} copy`, file.text);
      await refresh();
      switchTo(created.id);
    },
    onRename: (name: string) => store.edit([{ path: ["name"], value: name }]),
    onDelete: async () => {
      await api.remove(file.id);
      const l = await refresh();
      const next = l.find((p) => p.id !== file.id);
      if (next) switchTo(next.id); else setWantedId(null);
    },
  };

  return (
    <ProfileIdContext.Provider value={file.id}>
      <Workspace key={file.id} profile={file.profile} profileText={file.text} path={file.path} error={file.error} edit={store.edit} saving={store.saving}
        switcher={<ProfileSwitcher profiles={list} currentId={file.id} currentName={currentName} {...actions} />} />
    </ProfileIdContext.Provider>
  );
}

interface WorkspaceProps { profile: Profile; profileText: string; path: string; error: string | null; edit: (edits: ProfileEdit[]) => void; saving: boolean; switcher: React.ReactNode; }

function Workspace({ profile, profileText, path, error, edit, saving, switcher }: WorkspaceProps) {
  const years = planYears(profile);
  const yearsKey = years.join(",");
  const [focusYear, setFocusYear] = usePersisted<number>("focusYear", years[0]!, (v): v is number => typeof v === "number");
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [intakeOpen, setIntakeOpenState] = useState(() => location.hash === "#intake");
  const [factsTab, setFactsTabState] = useState<FactTab | null>(() => { const m = /^#facts(?:\/(\w+))?$/.exec(location.hash); return m ? (isFactTab(m[1]) ? m[1] : "you") : null; });
  const [lastFactsTab, setLastFactsTab] = usePersisted<FactTab>("factsTab", "you", isFactTab);
  const openFacts = (tab?: FactTab) => { const t = tab ?? lastFactsTab; setFactsTabState(t); setLastFactsTab(t); setHash(`facts/${t}`); };
  const closeFacts = () => { setFactsTabState(null); setHash(null); };
  const setIntakeOpen = (v: boolean) => { setIntakeOpenState(v); if (v) setFactsTabState(null); setHash(v ? "intake" : null); };
  const select = (sel: Selection | null) => setSelected(sel);

  useEffect(() => { if (!years.includes(focusYear)) setFocusYear(years[0]!); }, [yearsKey, focusYear]);

  const levers = useMemo(() => resolveLevers(profile), [profile]);
  const scenarioName = profile.activeScenario ?? "default";
  const scenario = useMemo(() => activeScenario(profile), [profile]);
  const events = scenario.events;
  const plan = useMemo(() => runPlan(profile, levers), [profile, levers]);
  const isoCompanies = useMemo(() => companiesWithGrants(profile, "iso"), [profile]);
  const crossovers = useMemo(() => years.flatMap((y) => isoCompanies.map((c) => amtCrossover(profile, levers, y, c))), [profile, levers, yearsKey, isoCompanies]);
  const hasIso = isoCompanies.length > 0;
  const [selectedEvent, setSelectedEvent] = usePersisted<string | null>("selectedEvent", null, (v): v is string | null => v === null || typeof v === "string");
  // The AMT chart follows the focused year; selecting anything on the timeline focuses its year.
  const sweepYear = years.includes(focusYear) ? focusYear : years[0]!;
  const recoveries = useMemo(() => isoCompanies.map((c) => ({ company: c, name: profile.equity.companies.find((x) => x.id === c)?.name, r: creditRecovery(profile, levers, sweepYear, c) })).filter((x) => x.r), [profile, levers, sweepYear, isoCompanies]);
  const sweeps = useMemo(() => isoCompanies.map((c) => ({ company: c, name: profile.equity.companies.find((x) => x.id === c)?.name ?? c, sweep: sweepIsoExercise(profile, levers, sweepYear, 40, c), crossover: crossovers.find((x) => x.year === sweepYear && x.company === c)! })), [profile, levers, sweepYear, isoCompanies, crossovers]);

  const writeEvents = (next: ScenarioEvent[]) => {
    const edits: ProfileEdit[] = [];
    if (!profile.scenarios?.[scenarioName]) edits.push({ path: ["activeScenario"], value: scenarioName });
    edits.push(...scenarioEdits(scenarioName, next));
    edit(edits);
  };
  const facts = useMemo(() => factMarkers(profile, years, () => {}, () => openFacts("equity")), [profile, yearsKey]);
  const selectEvent = (id: string | null) => {
    setSelectedEvent(id);
    const year = events.find((x) => x.id === id)?.year ?? facts.find((f) => f.id === id)?.year;
    if (year !== undefined) setFocusYear(year);
  };
  const addEvent = (what: AddKind, year: number) => {
    const existing = what.kind === "exercise" ? events.find((e) => e.kind === "exercise" && e.type === what.type && e.year === year && (e.company ?? profile.equity.companies[0]?.id) === (what.company ?? profile.equity.companies[0]?.id)) : undefined;
    if (existing) { selectEvent(existing.id); return; }
    const id = newEventId(events);
    if (what.kind === "liquidity") { const dup = events.find((e) => e.kind === "liquidity"); if (dup) { changeEvent(dup.id, { year }); selectEvent(dup.id); return; } }
    const event: ScenarioEvent = what.kind === "exercise" ? { id, kind: "exercise", type: what.type, year, shares: 0, ...(what.company ? { company: what.company } : {}) } : what.kind === "sell" ? { id, kind: "sell", year, shares: 0 } : { id, kind: "liquidity", year };
    writeEvents([...events, event]);
    setSelectedEvent(id);
    setFocusYear(year);
  };
  const sellToCover = (id: string) => {
    const e = events.find((x) => x.id === id);
    if (!e || e.kind !== "sell") return;
    const n = sharesToCover(profile, levers, e.year, id);
    writeEvents(events.map((x) => (x.id === id ? { ...x, shares: n, lots: undefined } : x)));
  };
  const changeEvent = (id: string, patch: Partial<ScenarioEvent>) => {
    writeEvents(events.map((e) => (e.id === id ? ({ ...e, ...patch } as ScenarioEvent) : e)));
    if (typeof patch.year === "number") setFocusYear(patch.year);
  };
  const removeEvent = (id: string) => { writeEvents(events.filter((e) => e.id !== id)); if (selectedEvent === id) setSelectedEvent(null); };
  /** The sweep chart sets the ISO count for its year directly. */
  const setIsoShares = (year: number, n: number, company: string) => { const r = setExerciseEvent(events, "iso", year, n, profile.equity.companies.length > 1 ? company : undefined); writeEvents(r.events); if (r.id) setSelectedEvent(r.id); };
  const [ledgerOpen, setLedgerOpen] = usePersisted<boolean>("ledgerOpen", true, (v): v is boolean => typeof v === "boolean");
  const timeline = profile.timeline ?? [];
  const addFact = (path: string, year: number) => {
    const f = timelineFields().find((x) => x.path === path);
    const current = getPath(profile, path);
    const value = current !== undefined ? current : f?.type === "bool" ? true : f?.type === "enum" ? f.enum?.[0] : 0;
    edit([{ path: ["timeline"], value: [...timeline, { year, path, value }] }]);
    setSelectedEvent(`t${timeline.length}`);
    setFocusYear(year);
  };
  const changeFact = (i: number, entry: TimelineEntry) => { edit([{ path: ["timeline"], value: timeline.map((t, j) => (j === i ? entry : t)) }]); setFocusYear(entry.year); };
  const removeFact = (i: number) => { edit([{ path: ["timeline"], value: timeline.filter((_, j) => j !== i) }]); setSelectedEvent(null); };

  return (
    <div className={"app" + (selected ? " has-explain" : "")}>
      <header className="topbar">
        <div className="brand"><Mark size={24} /><Wordmark /></div>
        {switcher}
        <span className="chip">{statusName(profile.filer.filingStatus)} · {profile.filer.state}</span>
        <span className="chip">{years[0]}–{years[years.length - 1]}</span>
        <ScenarioBar profile={profile} scenario={scenario} edit={edit} />
        <span className="chip ghost" title="Edit this file; the app follows it">{path}{saving ? " · saving…" : ""}</span>
        <span className="spacer" />
        <ThemeToggle />
        <button type="button" className="btn edit-info" onClick={() => openFacts()}>Edit my information</button>
        {pinned
          ? <button type="button" className="btn" onClick={() => setPinned(null)}>Unpin</button>
          : <button type="button" className="btn primary" onClick={() => setPinned({ levers, plan })}>Pin this scenario</button>}
      </header>

      <aside className="sidebar">
        <Sidebar profile={profile} levers={levers} years={years} edit={edit} onOpenFacts={openFacts} />
      </aside>

      <main className="main">
        {error && <div className="error">Profile file has a problem; showing the last good version.{"\n"}{error}</div>}
        <Hero plan={plan} pinned={pinned?.plan ?? null} years={years} />
        <FollowUps profile={profile} edit={edit} />
        <section className="card timeline-card">
          <div className="card-head">
            <div>
              <h2>Your plan, year by year</h2>
              <div className="sub">Tax above, decisions below. Press + under a year to add one; click a chip to adjust it. {pinned ? "Gray columns are the pinned scenario." : ""}</div>
            </div>
            <div className="plan-years"><span className="muted small">Years</span><Segmented options={[...new Set([3, 5, 10, profile.plan.years])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: String(n) }))} value={String(profile.plan.years)} onChange={(v) => edit([{ path: ["plan", "years"], value: Number(v) }])} /></div>
          </div>
          <TaxStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} />
          <EventTimeline profile={profile} levers={levers} plan={plan} years={years} events={events} facts={facts} crossovers={crossovers} selectedId={selectedEvent} onSelect={selectEvent} onAdd={addEvent} onChange={changeEvent} onRemove={removeEvent} onSellToCover={sellToCover} onAddFact={addFact} onChangeFact={changeFact} onRemoveFact={removeFact} />
        </section>
        <section className="card">
          <h2>Cash by year</h2>
          <div className="sub">What arrives against what leaves, before living costs. Left bar in, right bar out; the number is the net.</div>
          <CashStrip plan={plan} focusYear={focusYear} onFocus={setFocusYear} />
        </section>
        {hasIso && (
          <div className="two-up">
            <section className="card">
              <h2>AMT credit bank</h2>
              <div className="sub">Credit on hand at each year end{profile.carryforwards?.amtCredit ? `, starting from the ${usdCompact(profile.carryforwards.amtCredit)} you brought in` : ""}.</div>
              <CreditStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} />
              {recoveries.map((x) => <CreditRecoveryView key={x.company} r={x.r!} companyName={isoCompanies.length > 1 ? x.name : undefined} />)}
              {recoveries.length === 0 && hasIso && <p className="muted small" style={{ margin: "8px 0 0" }}>Select or add an ISO exercise in {sweepYear} to see how its credit comes back.</p>}
            </section>
            {sweeps.map((s) => (
              <section className="card" key={s.company}>
                <h2>AMT in {sweepYear} vs {isoCompanies.length > 1 ? `${s.name} ` : ""}ISO shares exercised</h2>
                <div className="sub">Other years{isoCompanies.length > 1 ? " and other companies" : ""} held as they are. Click the curve to set the exercise.</div>
                <SweepChart sweep={s.sweep} crossover={s.crossover} current={exercisedIn(profile, levers, "iso", sweepYear, s.company)} onChange={(n) => setIsoShares(sweepYear, n, s.company)} />
              </section>
            ))}
          </div>
        )}
        <section className={"card" + (ledgerOpen ? "" : " folded")}>
          <button type="button" className="card-fold" onClick={() => setLedgerOpen((o) => !o)} aria-expanded={ledgerOpen}>
            <h2>Ledger</h2>
            <svg className="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="sub">{ledgerOpen ? "Click any number for the reason behind it." : "Every line of every year, with its reason."}</div>
          {ledgerOpen && <LedgerTable plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} selected={selected} onSelect={select} />}
        </section>
        <CalibrationCard profile={profile} />
      </main>

      {selected && (
        <aside className="explain">
          <ExplainPanel plan={plan} pinned={pinned?.plan ?? null} selection={selected} onSelect={select} onClose={() => setSelected(null)} />
        </aside>
      )}
      {factsTab && <FactsModal profile={profile} years={years} tab={factsTab} onTab={openFacts} edit={edit} onClose={closeFacts} onOpenIntake={() => setIntakeOpen(true)} />}
      {intakeOpen && <IntakeModal mode="fill" profile={profile} onApply={edit} onClose={() => setIntakeOpen(false)} />}
    </div>
  );
}
