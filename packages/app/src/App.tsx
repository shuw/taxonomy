import { useEffect, useMemo, useRef, useState } from "react";
import { ProfileIdContext, usePersisted } from "./persist.ts";
import { useHashState } from "./hash.ts";
import { FactsModal, isFactTab, type FactTab } from "./components/FactsModal.tsx";
import { activeScenario, exercisedIn, planYears, resolveLevers, statusName, tools, type Levers, type PlanResult, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { EventTimeline } from "./components/timeline/EventTimeline.tsx";
import { factMarkers } from "./components/timeline/factMarkers.ts";
import { usePlanAnalyses } from "./hooks/usePlanAnalyses.ts";
import { useTimelineActions } from "./hooks/useTimelineActions.ts";
import { Segmented } from "./components/fields.tsx";
import { api, type ProfileSummary } from "./api.ts";
import { usdCompact } from "./format.ts";
import { useProfile, useProfileList } from "./useProfile.ts";
import { Hero } from "./components/Hero.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { ScenarioBar } from "./components/ScenarioBar.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { ProfileSwitcher } from "./components/ProfileSwitcher.tsx";
import { TaxStrip, CreditStrip, CashStrip, CombinedStrip } from "./components/Strips.tsx";
import { SweepChart } from "./components/SweepChart.tsx";
import { LedgerTable } from "./components/LedgerTable.tsx";
import { ExplainPanel } from "./components/ExplainPanel.tsx";
import { Mark, Wordmark } from "./components/Mark.tsx";
import { IntakeModal } from "./components/IntakeModal.tsx";
import { CalibrationCard } from "./components/CalibrationCard.tsx";
import { CreditRecoveryView } from "./components/CreditRecovery.tsx";
import { HoldOrSellCard } from "./components/HoldOrSell.tsx";
import { FollowUps } from "./components/FollowUps.tsx";
import { ProposalBanner } from "./components/ProposalBanner.tsx";

export interface Pinned { levers: Levers; plan: PlanResult; }
export interface Selection { year: number; id: string; }

const STORAGE_KEY = "taxonomy.profile";

function rememberedId(): string | null {
  const fromUrl = new URLSearchParams(location.search).get("p");
  if (fromUrl) return fromUrl;
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
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
  const [creating, setCreating] = useHashState((h) => h === "#new", (v) => (v ? "new" : null));

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

/** Copies a question with this plan's numbers in it, for an agent that cannot reach the server (Claude on the web). */
function AskButton({ profile, year }: { profile: Profile; year: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(tools.askText(profile, year)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return <button type="button" className="btn" title="Copy a question with this plan's numbers in it, to paste into any agent" onClick={() => void copy()}>{copied ? "Copied" : "Ask your agent"}</button>;
}

interface WorkspaceProps { profile: Profile; profileText: string; path: string; error: string | null; edit: (edits: ProfileEdit[]) => void; saving: boolean; switcher: React.ReactNode; }

type PlanView = "combined" | "tax" | "cash";
const isPlanView = (v: unknown): v is PlanView => v === "combined" || v === "tax" || v === "cash";

function Workspace({ profile, profileText, path, error, edit, saving, switcher }: WorkspaceProps) {
  const years = planYears(profile);
  const yearsKey = years.join(",");
  const [focusYear, setFocusYear] = usePersisted<number>("focusYear", years[0]!, (v): v is number => typeof v === "number");
  const [selectedEvent, setSelectedEvent] = usePersisted<string | null>("selectedEvent", null, (v): v is string | null => v === null || typeof v === "string");
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [ledgerOpen, setLedgerOpen] = usePersisted<boolean>("ledgerOpen", true, (v): v is boolean => typeof v === "boolean");
  const [planView, setPlanView] = usePersisted<PlanView>("planView", "combined", isPlanView);

  // Dialogs live in the hash; opening the intake closes the information dialog.
  const [intakeOpen, setIntakeOpenState] = useHashState((h) => h === "#intake", (v) => (v ? "intake" : null));
  const [factsTab, setFactsTabState] = useHashState<FactTab | null>((h) => { const m = /^#facts(?:\/(\w+))?$/.exec(h); return m ? (isFactTab(m[1]) ? m[1] : "you") : null; }, (t) => (t ? `facts/${t}` : null));
  const [lastFactsTab, setLastFactsTab] = usePersisted<FactTab>("factsTab", "you", isFactTab);
  const openFacts = (tab?: FactTab) => { const t = tab ?? lastFactsTab; setFactsTabState(t); setLastFactsTab(t); };
  const closeFacts = () => setFactsTabState(null);
  const setIntakeOpen = (v: boolean) => { if (v) setFactsTabState(null); setIntakeOpenState(v); };

  useEffect(() => { if (!years.includes(focusYear)) setFocusYear(years[0]!); }, [yearsKey, focusYear]);

  const levers = useMemo(() => resolveLevers(profile), [profile]);
  const scenario = useMemo(() => activeScenario(profile), [profile]);
  const events = scenario.events;
  const sweepYear = years.includes(focusYear) ? focusYear : years[0]!;
  const { plan, isoCompanies, crossovers, byCompany } = usePlanAnalyses(profile, levers, sweepYear);
  const hasIso = isoCompanies.length > 0;
  const facts = useMemo(() => factMarkers(profile, years, () => openFacts("equity")), [profile, yearsKey]);
  const actions = useTimelineActions({ profile, levers, events, facts, edit, selectedId: selectedEvent, setSelectedId: setSelectedEvent, setFocusYear });

  // A remembered selection focuses its year once on load, as a click would.
  const reconciled = useRef(false);
  useEffect(() => {
    if (reconciled.current) return;
    reconciled.current = true;
    const year = events.find((x) => x.id === selectedEvent)?.year ?? facts.find((f) => f.id === selectedEvent)?.year;
    if (year !== undefined && years.includes(year)) setFocusYear(year);
  }, []);

  const strip = planView === "combined"
    ? <CombinedStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} />
    : planView === "tax"
      ? <TaxStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} />
      : <CashStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} />;
  const stripCopy = planView === "combined"
    ? "Each bar is the year's cash in: tax at the bottom, then exercise cost, then what you keep. The number is the net."
    : planView === "tax" ? "Tax above, decisions below." : "Cash in (left bar) against cash out (right bar), before living costs; the number is the net.";

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
        <ProposalBanner profile={profile} edit={edit} onCompare={() => setPinned({ levers, plan })} />
        <Hero plan={plan} pinned={pinned?.plan ?? null} years={years} />
        <FollowUps profile={profile} edit={edit} />
        <section className="card timeline-card">
          <div className="card-head">
            <div>
              <h2>Your plan, year by year</h2>
              <div className="sub">{stripCopy} Press + under a year to add a decision; click a chip to adjust it. {pinned && planView !== "cash" ? "Gray columns are the pinned scenario." : ""}</div>
            </div>
            <div className="plan-years"><Segmented options={[{ value: "combined", label: "Combined" }, { value: "tax", label: "Tax" }, { value: "cash", label: "Cash" }]} value={planView} onChange={setPlanView} /></div>
            <AskButton profile={profile} year={focusYear} />
            <div className="plan-years"><span className="muted small">Years</span><Segmented options={[...new Set([3, 5, 10, profile.plan.years])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: String(n) }))} value={String(profile.plan.years)} onChange={(v) => edit([{ path: ["plan", "years"], value: Number(v) }])} /></div>
          </div>
          {strip}
          <EventTimeline profile={profile} levers={levers} plan={plan} years={years} events={events} facts={facts} crossovers={crossovers} selectedId={selectedEvent}
            onSelect={actions.select} onAdd={actions.add} onChange={actions.change} onRemove={actions.remove} onSellToCover={actions.sellToCover}
            onAddFact={actions.addFact} onChangeFact={actions.changeFact} onRemoveFact={actions.removeFact} />
        </section>
        {hasIso && (
          <div className="two-up">
            <section className="card">
              <h2>AMT credit bank</h2>
              <div className="sub">Credit on hand at each year end{profile.carryforwards?.amtCredit ? `, starting from the ${usdCompact(profile.carryforwards.amtCredit)} you brought in` : ""}.</div>
              <CreditStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} />
              {byCompany.filter((c) => c.recovery).map((c) => <CreditRecoveryView key={c.company} r={c.recovery!} companyName={isoCompanies.length > 1 ? c.name : undefined} />)}
              {byCompany.every((c) => !c.recovery) && <p className="muted small" style={{ margin: "8px 0 0" }}>Select or add an ISO exercise in {sweepYear} to see how its credit comes back.</p>}
            </section>
            {byCompany.map((c) => (
              <section className="card" key={c.company}>
                <h2>AMT in {sweepYear} vs {isoCompanies.length > 1 ? `${c.name} ` : ""}ISO shares exercised</h2>
                <div className="sub">Other years{isoCompanies.length > 1 ? " and other companies" : ""} held as they are. Click the curve to set the exercise.</div>
                <SweepChart sweep={c.sweep} crossover={c.crossover} current={exercisedIn(profile, levers, "iso", sweepYear, c.company)} onChange={(n) => actions.setIsoShares(sweepYear, n, c.company)} />
              </section>
            ))}
          </div>
        )}
        {byCompany.filter((c) => c.hold).map((c) => <HoldOrSellCard key={c.company} h={c.hold!} companyName={isoCompanies.length > 1 ? c.name : undefined} />)}
        <section className={"card" + (ledgerOpen ? "" : " folded")}>
          <button type="button" className="card-fold" onClick={() => setLedgerOpen((o) => !o)} aria-expanded={ledgerOpen}>
            <h2>Ledger</h2>
            <svg className="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="sub">{ledgerOpen ? "Click any number for the reason behind it." : "Every line of every year, with its reason."}</div>
          {ledgerOpen && <LedgerTable plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} selected={selected} onSelect={setSelected} />}
        </section>
        <CalibrationCard profile={profile} />
      </main>

      {selected && (
        <aside className="explain">
          <ExplainPanel plan={plan} pinned={pinned?.plan ?? null} selection={selected} onSelect={setSelected} onClose={() => setSelected(null)} />
        </aside>
      )}
      {factsTab && <FactsModal profile={profile} years={years} tab={factsTab} onTab={openFacts} edit={edit} onClose={closeFacts} onOpenIntake={() => setIntakeOpen(true)} />}
      {intakeOpen && <IntakeModal mode="fill" profile={profile} onApply={edit} onClose={() => setIntakeOpen(false)} />}
    </div>
  );
}
