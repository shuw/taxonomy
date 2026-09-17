import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ProfileIdContext, usePersisted } from "./persist.ts";
import { useHashState } from "./hash.ts";
import { FactsModal, isFactTab, type FactTab } from "./components/FactsModal.tsx";
import { activeScenario, exercisedIn, planYears, resolveLevers, statusName, type Levers, type PlanResult, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { EventTimeline } from "./components/timeline/EventTimeline.tsx";
import { factMarkers } from "./components/timeline/factMarkers.ts";
import { usePlanAnalyses } from "./hooks/usePlanAnalyses.ts";
import { useDebounced } from "./hooks/useDebounced.ts";
import { useTimelineActions } from "./hooks/useTimelineActions.ts";
import { Segmented } from "./components/fields.tsx";
import { Info } from "./components/Info.tsx";
import { api, type ProfileSummary } from "./api.ts";
import { demo, usdCompact } from "./format.ts";
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
import { setPersisted } from "./persist.ts";
import { ShortcutsHelp } from "./components/ShortcutsHelp.tsx";
import { ClaudePanel, ClaudeStatusButton } from "./components/ClaudePanel.tsx";
import { HistoryModal } from "./components/HistoryModal.tsx";
import { useAgentStatus } from "./hooks/useAgentStatus.ts";
import { useClaudeNews } from "./hooks/useClaudeNews.ts";
import { MobileNotice } from "./components/MobileNotice.tsx";
import { useShortcuts, type Shortcut } from "./hooks/useShortcuts.ts";
import { useSession } from "./hooks/useSession.ts";
import { Login } from "./components/Login.tsx";

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

/** With accounts on, nothing loads until someone is signed in; without them, straight to the profiles. */
export function App() {
  const { session, refresh, signOut } = useSession();
  if (session === null) return <div className="empty">Loading…</div>;
  if (session.enabled && !session.user) return <Login signup={session.signup} onDone={() => void refresh()} />;
  return <Signed account={session.user} signOut={signOut} />;
}

function Signed({ account, signOut }: { account: { email: string } | null; signOut: () => Promise<void> }) {
  const { list, refresh } = useProfileList();
  const [wantedId, setWantedId] = useState<string | null>(rememberedId);
  const [creating, setCreating] = useHashState((h) => h === "#new", (v) => (v ? "new" : null));

  const currentId = useMemo(() => {
    if (!list || list.length === 0) return null;
    return list.some((p) => p.id === wantedId) ? wantedId : list[0]!.id;
  }, [list, wantedId]);
  useEffect(() => { if (currentId) { remember(currentId); api.setCurrent(currentId).catch(() => {}); } }, [currentId]);

  const store = useProfile(currentId);
  // The first-run wizard stays up once shown: creating the draft makes the list non-empty, which must not close it.
  const [firstRun, setFirstRun] = useState(false);
  useEffect(() => { if (list !== null && list.length === 0) setFirstRun(true); }, [list]);
  const needIntake = list !== null && (firstRun || creating);

  const switchTo = (id: string) => { setWantedId(id); setCreating(false); setFirstRun(false); };
  const done = async (id: string, awaitAgent: boolean) => {
    if (awaitAgent) setPersisted(id, "awaitingAgent", true);
    await refresh();
    switchTo(id);
  };

  if (list === null) return <div className="empty">Loading profiles…</div>;
  if (needIntake) return <IntakeModal mode="create" onDone={done} onOpen={(id) => { setFirstRun(false); switchTo(id); }} onClose={!firstRun && list.length > 0 ? () => setCreating(false) : undefined} />;
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
      await api.remove(file.id, true);
      const l = await refresh();
      const next = l.find((p) => p.id !== file.id);
      if (next) switchTo(next.id); else setWantedId(null);
    },
  };

  return (
    <ProfileIdContext.Provider value={file.id}>
      <Workspace key={file.id} profile={file.profile} profileText={file.text} path={file.path} error={file.error} edit={store.edit} saving={store.saving}
        switcher={<ProfileSwitcher profiles={list} currentId={file.id} currentName={currentName} {...actions} />} account={account} signOut={signOut} />
    </ProfileIdContext.Provider>
  );
}

interface WorkspaceProps { profile: Profile; profileText: string; path: string; error: string | null; edit: (edits: ProfileEdit[]) => void; saving: boolean; switcher: React.ReactNode; account: { email: string } | null; signOut: () => Promise<void>; }

type PlanView = "combined" | "tax" | "cash";
const isPlanView = (v: unknown): v is PlanView => v === "combined" || v === "tax" || v === "cash";

function Workspace({ profile, profileText, path, error, edit, saving, switcher, account, signOut }: WorkspaceProps) {
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
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
  const [claudeOpen, setClaudeOpen] = useHashState((h) => h === "#claude", (v) => (v ? "claude" : null));
  const [historyOpen, setHistoryOpen] = useHashState((h) => h === "#history", (v) => (v ? "history" : null));
  const agent = useAgentStatus();
  const claudeNews = useClaudeNews(useContext(ProfileIdContext));
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
  // Inputs answer at once; the engine runs once a burst of edits (a slider drag) settles.
  const engineProfile = useDebounced(profile);
  const engineLevers = useMemo(() => (engineProfile === profile ? levers : resolveLevers(engineProfile)), [engineProfile, profile, levers]);
  const { plan, isoCompanies, crossovers, byCompany } = usePlanAnalyses(engineProfile, engineLevers, sweepYear);
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

  // A click on a year also clears a selection that sits under another year; a hover only moves the focus.
  const pickYear = (y: number) => {
    setFocusYear(y);
    const selectedYear = events.find((x) => x.id === selectedEvent)?.year ?? facts.find((f) => f.id === selectedEvent)?.year;
    if (selectedYear !== undefined && selectedYear !== y) setSelectedEvent(null);
  };
  const [helpOpen, setHelpOpen] = useState(false);
  const stepYear = (d: number) => { const i = years.indexOf(focusYear); const next = years[Math.min(years.length - 1, Math.max(0, i + d))]; if (next !== undefined) pickYear(next); };
  const shortcuts = useMemo<Shortcut[]>(() => [
    { keys: ["1"], label: "Combined view", run: () => setPlanView("combined") },
    { keys: ["2"], label: "Tax view", run: () => setPlanView("tax") },
    { keys: ["3"], label: "Cash view", run: () => setPlanView("cash") },
    { keys: ["ArrowLeft", "ArrowRight"], label: "Previous or next year", run: () => {} },
    { keys: ["e"], label: "Edit my information", run: () => openFacts() },
    { keys: ["p"], label: "Pin or unpin this scenario", run: () => setPinned((cur) => (cur ? null : { levers, plan })) },
    { keys: ["l"], label: "Show or hide the ledger", run: () => setLedgerOpen((o) => !o) },
    { keys: ["c"], label: "Claude: status and things to say", run: () => setClaudeOpen(true) },
    { keys: ["h"], label: "History of changes", run: () => setHistoryOpen(true) },
    { keys: ["?"], label: "These shortcuts", run: () => setHelpOpen((o) => !o), always: true },
    { keys: ["Escape"], label: "Close the panel or dialog", run: () => {
      // A dialog closes itself; only when none is open does Escape clear what is selected on the page.
      if (helpOpen || claudeOpen || historyOpen || factsTab || intakeOpen) { setHelpOpen(false); setClaudeOpen(false); setHistoryOpen(false); return; }
      setSelected(null); setSelectedEvent(null);
    }, always: true },
  ], [levers, plan, years, focusYear]);
  const keyed = useMemo<Shortcut[]>(() => shortcuts.flatMap((s) => s.keys[0] === "ArrowLeft"
    ? [{ ...s, keys: ["ArrowLeft"], run: () => stepYear(-1) }, { ...s, keys: ["ArrowRight"], run: () => stepYear(1) }]
    : [s]), [shortcuts]);
  useShortcuts(keyed);

  const strip = planView === "combined"
    ? <CombinedStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} onPick={pickYear} />
    : planView === "tax"
      ? <TaxStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} onPick={pickYear} />
      : <CashStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} onPick={pickYear} />;
  const stripCopy = planView === "combined"
    ? "Each bar is the year's cash in: tax at the bottom, then exercise cost, then what you keep. The number is the net."
    : planView === "tax" ? "Tax above, decisions below." : "Cash in (left bar) against cash out (right bar), before living costs; the number is the net.";

  return (
    <div className={"app" + (selected ? " has-explain" : "")}>
      <header className="topbar">
        <div className="brand"><Mark size={24} /><Wordmark /></div>
        {switcher}
        <span className="chip">{statusName(profile.filer.filingStatus)} · {profile.filer.state}</span>
        {demo.on && <span className="chip demo" title="Amounts are shown in a made-up currency at a fixed scale; your file is unchanged">Demo · {demo.symbol}</span>}
        <ScenarioBar profile={profile} scenario={scenario} edit={edit} />
        <span className="spacer" />
        <ThemeToggle />
        <ClaudeStatusButton status={agent} news={claudeNews.news.length} onClick={() => setClaudeOpen(true)} />
        <button type="button" className="btn" title="History of changes (H)" onClick={() => setHistoryOpen(true)}>History</button>
        <button type="button" className="btn icon" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(true)}>?</button>
        <button type="button" className="btn edit-info" onClick={() => openFacts()}>Edit my information <kbd>E</kbd></button>
        {account && <button type="button" className="btn" title={`Signed in as ${account.email}`} onClick={() => void signOut()}>Sign out</button>}
        {pinned
          ? <button type="button" className="btn" onClick={() => setPinned(null)}>Unpin <kbd>P</kbd></button>
          : <button type="button" className="btn primary" title="Pin this scenario to compare against" onClick={() => setPinned({ levers, plan })}>Pin <kbd>P</kbd></button>}
      </header>

      <aside className="sidebar">
        <Sidebar profile={profile} levers={levers} years={years} edit={edit} onOpenFacts={openFacts} />
      </aside>

      <main className="main">
        <MobileNotice />
        {error && <div className="error">Profile file has a problem; showing the last good version.{"\n"}{error}</div>}
        <ProposalBanner profile={profile} edit={edit} onCompare={() => setPinned({ levers, plan })} onReviewIntake={(d) => { setReviewDocId(d.id); setIntakeOpen(true); }} onCopyRequest={() => { setReviewDocId(null); setIntakeOpen(true); }} onEditFacts={() => openFacts("you")} onClaude={() => setClaudeOpen(true)} />
        <Hero plan={plan} pinned={pinned?.plan ?? null} years={years} />
        <FollowUps profile={profile} edit={edit} onSecondLook={() => openFacts("history")} />
        <section className="card timeline-card">
          <div className="card-head">
            <div>
              <h2>Your plan, year by year <Info label="How to read the plan">{stripCopy} Press + under a year to add a decision; click a chip to adjust it. Hover a year to focus it.{pinned && planView !== "cash" ? " Gray columns are the pinned scenario." : ""}</Info></h2>
            </div>
            <div className="plan-years"><Segmented options={[{ value: "combined", label: "Combined", key: "1" }, { value: "tax", label: "Tax", key: "2" }, { value: "cash", label: "Cash", key: "3" }]} value={planView} onChange={setPlanView} /></div>
            <div className="plan-years"><span className="muted small">Years</span><Segmented options={[...new Set([3, 5, 10, profile.plan.years])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: String(n) }))} value={String(profile.plan.years)} onChange={(v) => edit([{ path: ["plan", "years"], value: Number(v) }])} /></div>
          </div>
          {strip}
          <EventTimeline profile={profile} levers={levers} plan={plan} years={years} events={events} facts={facts} crossovers={crossovers} selectedId={selectedEvent} focusYear={focusYear}
            onSelect={actions.select} onAdd={actions.add} onChange={actions.change} onRemove={actions.remove} onSellToCover={actions.sellToCover}
            onAddFact={actions.addFact} onChangeFact={actions.changeFact} onRemoveFact={actions.removeFact} />
        </section>
        {hasIso && (
          <div className="two-up">
            <section className="card">
              <h2>AMT credit bank <Info label="About the credit bank">Credit on hand at each year end{profile.carryforwards?.amtCredit ? `, starting from the ${usdCompact(profile.carryforwards.amtCredit)} you brought in` : ""}. AMT paid on an ISO exercise comes back as a credit in later years, as far as regular tax exceeds the minimum tax.</Info></h2>
              <CreditStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} onPick={pickYear} />
              {byCompany.filter((c) => c.recovery).map((c) => <CreditRecoveryView key={c.company} r={c.recovery!} companyName={isoCompanies.length > 1 ? c.name : undefined} />)}
              {byCompany.every((c) => !c.recovery) && <p className="muted small" style={{ margin: "8px 0 0" }}>Select or add an ISO exercise in {sweepYear} to see how its credit comes back.</p>}
            </section>
            {byCompany.map((c) => (
              <section className="card" key={c.company}>
                <h2>AMT in {sweepYear} vs {isoCompanies.length > 1 ? `${c.name} ` : ""}ISO shares exercised <Info label="About this chart">AMT for {sweepYear} as the number of ISO shares exercised that year varies, with other years{isoCompanies.length > 1 ? " and other companies" : ""} held as they are. Click the curve to set the exercise.</Info></h2>
                <SweepChart sweep={c.sweep} crossover={c.crossover} current={exercisedIn(engineProfile, engineLevers, "iso", sweepYear, c.company)} onChange={(n) => actions.setIsoShares(sweepYear, n, c.company)} />
              </section>
            ))}
          </div>
        )}
        {byCompany.filter((c) => c.hold).map((c) => <HoldOrSellCard key={c.company} h={c.hold!} companyName={isoCompanies.length > 1 ? c.name : undefined} />)}
        <section className={"card" + (ledgerOpen ? "" : " folded")}>
          <button type="button" className="card-fold" onClick={() => setLedgerOpen((o) => !o)} aria-expanded={ledgerOpen}>
            <h2>Ledger</h2>
            <span className="muted small fold-hint">{ledgerOpen ? "Click any number for the reason behind it" : "Every line of every year, with its reason"}</span>
            <svg className="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {ledgerOpen && <LedgerTable plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} selected={selected} onSelect={setSelected} />}
        </section>
        <CalibrationCard profile={profile} />
        <footer className="foot">Taxonomy is a planning aid, not tax, legal or financial advice, and not a filing tool. Every figure is an estimate; rules, thresholds and your facts change. Your data stays in files on this computer.</footer>
      </main>

      {selected && (
        <aside className="explain">
          <ExplainPanel plan={plan} pinned={pinned?.plan ?? null} selection={selected} onSelect={setSelected} onClose={() => setSelected(null)} />
        </aside>
      )}
      {helpOpen && <ShortcutsHelp shortcuts={shortcuts} onClose={() => setHelpOpen(false)} />}
      {claudeOpen && <ClaudePanel profile={profile} news={claudeNews.news} onSeen={claudeNews.markSeen} onHistory={() => { setClaudeOpen(false); setHistoryOpen(true); }} onClose={() => setClaudeOpen(false)} />}
      {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} />}
      {factsTab && <FactsModal profile={profile} years={years} tab={factsTab} onTab={openFacts} edit={edit} onClose={closeFacts} onOpenIntake={() => setIntakeOpen(true)} path={path} saving={saving} />}
      {intakeOpen && (() => {
        const doc = profile.pendingIntake?.find((d) => d.id === reviewDocId) ?? profile.pendingIntake?.[0];
        const rest = (profile.pendingIntake ?? []).filter((d) => d.id !== doc?.id);
        return <IntakeModal mode="fill" profile={profile} doc={doc} onApply={(edits) => edit(doc ? [...edits, { path: ["pendingIntake"], value: rest.length ? rest : undefined }] : edits)} onClose={() => setIntakeOpen(false)} />;
      })()}
    </div>
  );
}
