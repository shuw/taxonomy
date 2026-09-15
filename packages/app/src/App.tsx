import { useEffect, useMemo, useState } from "react";
import { ProfileIdContext, usePersisted } from "./persist.ts";
import { FactsModal, isFactTab, type FactTab } from "./components/FactsModal.tsx";
import { amtCrossover, planYears, resolveLevers, runPlan, sweepIsoExercise, statusName, type Levers, type PlanResult, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { api, type ProfileSummary } from "./api.ts";
import { useProfile, useProfileList } from "./useProfile.ts";
import { Hero } from "./components/Hero.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { ScenarioBar } from "./components/ScenarioBar.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { ProfileSwitcher } from "./components/ProfileSwitcher.tsx";
import { TaxStrip, CreditStrip } from "./components/Strips.tsx";
import { SweepChart } from "./components/SweepChart.tsx";
import { LedgerTable } from "./components/LedgerTable.tsx";
import { ExplainPanel } from "./components/ExplainPanel.tsx";
import { Mark, Wordmark } from "./components/Mark.tsx";
import { IntakeModal } from "./components/IntakeModal.tsx";
import { CalibrationCard } from "./components/CalibrationCard.tsx";
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
  const scenario = profile.activeScenario ?? "default";
  const plan = useMemo(() => runPlan(profile, levers), [profile, levers]);
  const crossovers = useMemo(() => years.map((y) => amtCrossover(profile, levers, y)), [profile, levers, yearsKey]);
  const sweep = useMemo(() => sweepIsoExercise(profile, levers, focusYear, 40), [profile, levers, focusYear]);
  const focusCrossover = crossovers.find((c) => c.year === focusYear) ?? crossovers[0]!;
  const hasIso = profile.equity.grants.some((g) => g.type === "iso");

  const setExercise = (type: "iso" | "nso", year: number, n: number) => {
    const edits: ProfileEdit[] = [];
    if (!profile.scenarios?.[scenario]) edits.push({ path: ["scenarios", scenario], value: levers }, { path: ["activeScenario"], value: scenario });
    edits.push({ path: ["scenarios", scenario, "exercises", type, year], value: Math.max(0, Math.round(n)) });
    edit(edits);
  };

  return (
    <div className={"app" + (selected ? " has-explain" : "")}>
      <header className="topbar">
        <div className="brand"><Mark size={24} /><Wordmark /></div>
        {switcher}
        <span className="chip">{statusName(profile.filer.filingStatus)} · {profile.filer.state}</span>
        <span className="chip">{years[0]}–{years[years.length - 1]}</span>
        <ScenarioBar profile={profile} levers={levers} edit={edit} />
        <span className="chip ghost" title="Edit this file; the app follows it">{path}{saving ? " · saving…" : ""}</span>
        <span className="spacer" />
        <ThemeToggle />
        <button type="button" className="btn" onClick={() => openFacts()}>Facts</button>
        {pinned
          ? <button type="button" className="btn" onClick={() => setPinned(null)}>Unpin</button>
          : <button type="button" className="btn primary" onClick={() => setPinned({ levers, plan })}>Pin this scenario</button>}
      </header>

      <aside className="sidebar">
        <Sidebar profile={profile} levers={levers} crossovers={crossovers} years={years} focusYear={focusYear} onFocus={setFocusYear} onExercise={setExercise} edit={edit} onOpenFacts={openFacts} />
      </aside>

      <main className="main">
        {error && <div className="error">Profile file has a problem; showing the last good version.{"\n"}{error}</div>}
        <Hero plan={plan} pinned={pinned?.plan ?? null} years={years} />
        <FollowUps profile={profile} edit={edit} />
        <section className="card">
          <h2>Tax by year</h2>
          <div className="sub">Click a year to focus it. {pinned ? "Gray columns are the pinned scenario." : ""}</div>
          <TaxStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} />
        </section>
        {hasIso && (
          <div className="two-up">
            <section className="card">
              <h2>AMT credit bank</h2>
              <div className="sub">Credit generated by ISO exercises, waiting to offset regular tax in later years.</div>
              <CreditStrip plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} onFocus={setFocusYear} />
            </section>
            <section className="card">
              <h2>AMT in {focusYear} vs shares exercised</h2>
              <div className="sub">Holding the other years fixed. The marker is where AMT starts; click the curve to set the lever.</div>
              <SweepChart sweep={sweep} crossover={focusCrossover} current={levers.exercises.iso[focusYear] ?? 0} onChange={(n) => setExercise("iso", focusYear, n)} />
            </section>
          </div>
        )}
        <section className="card">
          <h2>Ledger</h2>
          <div className="sub">Click any number for the reason behind it.</div>
          <LedgerTable plan={plan} pinned={pinned?.plan ?? null} focusYear={focusYear} selected={selected} onSelect={select} />
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
