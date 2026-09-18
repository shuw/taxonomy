import { useContext, useEffect, useMemo, useState } from "react";
import { changesToEdits, DOCUMENT_SECTIONS, editProfileText, followUpEdits, intakePrompt, INTAKE_SECTIONS, parseIntake, parseProfile, profilePathForIntake, reviewIntake, stringifyProfile, type IntakeChange, type IntakeSection, type PendingIntake, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, shares, usd, demoText } from "../format.ts";
import { Field, parseAmount } from "./fields.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { api, type HistoryRow } from "../api.ts";
import { ProfileIdContext } from "../persist.ts";
import { useProfile } from "../useProfile.ts";
import { setHash } from "../hash.ts";
import { AgentSetup } from "./ConnectAgent.tsx";
import { Segmented } from "./fields.tsx";
import { useAgentStatus } from "../hooks/useAgentStatus.ts";

interface FillProps { mode: "fill"; profile: Profile; /** The agent's document being reviewed, if any. */ doc?: PendingIntake; onApply: (edits: ProfileEdit[]) => void; onClose: () => void; /** Open History, where Claude's writes can be undone. */ onHistory?: () => void; }
interface CreateProps { mode: "create"; onDone: (id: string, awaitAgent: boolean) => Promise<void>; /** Switch to an existing profile instead. */ onOpen?: (id: string) => void; onClose?: () => void; /** On a hosted server: who is signed in, and a way out from the first screen. */ account?: { email: string; guest?: boolean } | null; signOut?: () => Promise<void>; }
type Props = FillProps | CreateProps;

interface Basics { name: string }
const REQUIRED_BASICS: { id: string; text: string; about: string }[] = [
  { id: "filer.filingStatus", text: "How do you file? Single, married filing jointly, separately, or head of household.", about: "filer.filingStatus" },
  { id: "filer.state", text: "Which state do you live in?", about: "filer.state" },
  { id: "people.self.salary", text: "What is your base salary? Base pay only; equity is counted from your grants.", about: "people.self.salary" },
  { id: "filer.dependents", text: "Any dependents? Their birth years, comma separated, or leave blank for none.", about: "filer.dependents" },
];

const thisYear = () => Math.max(2026, new Date().getFullYear());
const SHORT: Partial<Record<IntakeSection, string>> = { basics: "Filing", pay: "Pay", prior_return: "Last return", income: "Income", equity: "Equity", home: "Home", giving: "Giving", assumptions: "Assumptions" };

function profileTextFrom(b: Basics): string {
  return stringifyProfile({
    version: 3, name: b.name.trim() || "New profile",
    filer: { filingStatus: "single", state: "WA", dependents: [] },
    plan: { startYear: thisYear(), years: 5 },
    assumptions: { inflation: 0.025, wageGrowth: 0.03, fmvGrowth: 0.1 },
    people: { self: { salary: 0 } },
    income: {}, carryforwards: {}, equity: { companies: [], grants: [], holdings: [] }, home: {}, deductions: {},
    timeline: [], scenarios: { default: { events: [] } }, activeScenario: "default",
  });
}

const DRAFT_KEY = (scope: string) => `taxonomy.intake.${scope}`;
function loadDraft<T>(scope: string, fallback: T): T {
  try { const v = sessionStorage.getItem(DRAFT_KEY(scope)); return v ? { ...fallback, ...(JSON.parse(v) as Partial<T>) } : fallback; } catch { return fallback; }
}
function saveDraft(scope: string, value: unknown): void {
  try { sessionStorage.setItem(DRAFT_KEY(scope), JSON.stringify(value)); } catch {}
}
export function clearDraft(scope: string): void {
  try { sessionStorage.removeItem(DRAFT_KEY(scope)); } catch {}
}

export function IntakeModal(props: Props) {
  return props.mode === "create" ? <NewProfileWizard onDone={props.onDone} onOpen={props.onOpen} onClose={props.onClose} account={props.account} signOut={props.signOut} /> : <FillModal {...props} />;
}

/** Fill from documents for the profile on screen. */
function FillModal({ profile, doc, onApply, onClose, onHistory }: FillProps) {
  const scope = `fill.${profile.name ?? ""}`;
  const finish = async (edits: ProfileEdit[]) => { onApply(edits); clearDraft(`${scope}.paste`); onClose(); };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal intake-modal wide" role="dialog" aria-modal="true" aria-label="Fill from documents">
        <header className="modal-head">
          <div>
            <h3>Fill from documents</h3>
            <div className="muted small" style={{ margin: 0 }}>With Claude connected, values arrive on their own. A pasted reply is reviewed here first.</div>
          </div>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">×</button>
        </header>
        <AgentIntake profile={profile} doc={doc} name={profile.name?.trim() || "Me"} create={false} busy={false} error={null} onFinish={finish} scope={scope} onDone={onClose} onHistory={onHistory} />
      </div>
    </div>
  );
}

/** Nothing but a name: no pay, no equity, nothing pending, nothing dated. */
function untouched(p: Profile): boolean {
  return p.people.self.salary === 0 && !p.people.spouse && p.equity.grants.length === 0 && p.equity.companies.length === 0
    && !(p.pendingIntake?.length) && !(p.pending?.length) && !(p.timeline?.length) && !(p.returns?.length) && (p.scenarios?.default?.events.length ?? 0) === 0;
}

/**
 * New profile in two steps: a name, then the numbers. The profile file is created on leaving
 * step 1 so Claude has something to send to; going back or closing removes it again while it
 * is still empty.
 */
function NewProfileWizard({ onDone, onOpen, onClose, account, signOut }: Omit<CreateProps, "mode">) {
  const scope = "new";
  // On a hosted server the account's email suggests the name: "sam.lee@…" starts as "Sam".
  const suggested = account?.email && !account.guest ? (account.email.split("@")[0]!.split(/[._+-]/)[0] || "Me") : "Me";
  const [basics, setBasics] = useState<Basics>(() => loadDraft(`${scope}.basics`, { name: suggested.charAt(0).toUpperCase() + suggested.slice(1) }));
  useEffect(() => { saveDraft(`${scope}.basics`, basics); }, [basics]);
  const [draftId, setDraftIdState] = useState<string | null>(() => loadDraft(`${scope}.draft`, { id: null as string | null }).id);
  // Written at once, not in an effect: closing the wizard unmounts it before an effect would run.
  const setDraftId = (id: string | null) => { saveDraft(`${scope}.draft`, { id }); setDraftIdState(id); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameNeeded, setNameNeeded] = useState(false);
  const name = basics.name.trim();
  const store = useProfile(draftId);
  const draft = store.file?.id === draftId ? store.file.profile : null;
  const step = draftId ? 2 : 1;
  // A call about the draft after this moment is the handshake that ends the wizard.
  const [since] = useState(() => loadDraft(`${scope}.since`, { t: Date.now() }).t);
  useEffect(() => { saveDraft(`${scope}.since`, { t: since }); }, [since]);
  // A remembered draft whose file is gone (deleted elsewhere, or an older session) goes back to the name.
  useEffect(() => { if (draftId && store.file?.id === draftId && !store.file.profile && store.file.error) setDraftId(null); }, [draftId, store.file]);

  const [taken, setTaken] = useState<{ id: string; name: string } | null>(null);
  const next = async () => {
    if (!name) { setNameNeeded(true); document.getElementById("profile-name")?.focus(); return; }
    setBusy(true); setError(null); setTaken(null);
    try {
      // Two profiles with one name cannot be told apart in conversation, so the name has to be free.
      const existing = (await api.list()).find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
      if (existing) { setTaken(existing); return; }
      // The hash keeps the wizard open across a refresh; the draft id and typed text live in session storage.
      const created = await api.create(name, profileTextFrom(basics)); setDraftId(created.id); setHash("new");
    }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  };
  /** Only a draft nobody has put anything into is removed; a profile with data is never deleted here. */
  const discard = async () => {
    if (!draftId) return;
    if (!draft || untouched(draft)) { try { await api.remove(draftId); } catch { /* already gone */ } }
    setDraftId(null);
  };
  const back = async () => { await discard(); };
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const close = async () => { await discard(); onClose?.(); };

  const finish = async (edits: ProfileEdit[], provided: Set<string> = new Set(), awaitAgent = false) => {
    if (!draftId) return;
    setBusy(true); setError(null);
    try {
      const cur = await api.get(draftId);
      // Whatever the agent did not supply is asked on the main screen, not here.
      const reviewed = draft?.pendingIntake?.[0];
      const rest = (draft?.pendingIntake ?? []).filter((d) => d !== reviewed);
      const text = editProfileText(cur.text, [...edits, ...(reviewed ? [{ path: ["pendingIntake"], value: rest.length ? rest : undefined }] : [])]);
      const missing = REQUIRED_BASICS.filter((b) => !provided.has(b.id)).map((b, i) => ({ id: `m${i + 1}`, text: b.text, about: b.about, kind: "missing" as const, added: new Date().toISOString().slice(0, 10) }));
      const existing = parseProfile(text).followUps ?? [];
      const withMissing = missing.length ? editProfileText(text, [{ path: ["followUps"], value: [...missing, ...existing] }]) : text;
      await api.put(draftId, withMissing, cur.mtime);
      clearDraft(`${scope}.basics`); clearDraft(`${scope}.paste`); clearDraft(`${scope}.draft`); clearDraft(`${scope}.since`); clearDraft(`${scope}.mode`);
      await onDone(draftId, awaitAgent);
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) void close(); }} onKeyDown={(e) => { if (e.key === "Escape") void close(); }}>
      <div className={"modal intake-modal " + (step === 1 ? "narrow" : "wide")} role="dialog" aria-modal="true" aria-label="New profile">
        <header className="modal-head">
          <div>
            <h3>New profile <span className="muted step-count">step {step} of 2</span></h3>
            {account && signOut && <div className="muted small" style={{ margin: 0 }}>{account.guest ? "Trying the demo" : `Signed in as ${account.email}`} · <button type="button" className="link" onClick={() => void signOut()}>{account.guest ? "Create your own account" : "Sign out"}</button></div>}
            {step === 2 && <div className="muted small" style={{ margin: 0 }}>Connect Claude; it fills the profile in with you.</div>}
          </div>
          {!onClose && <ThemeToggle />}
          {onClose && <button type="button" className="btn icon" onClick={() => void close()} aria-label="Close">×</button>}
        </header>

        {step === 1 ? (
          <div className="modal-body">
            <Field label="Name" hint="you, or your household" wide error={nameNeeded && !name ? "Name this profile to continue." : undefined}>
              <span className="input-wrap"><input id="profile-name" autoFocus value={basics.name} onChange={(e) => setBasics({ name: e.target.value })} placeholder="e.g. Me, or Us" onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void next(); } }} /></span>
            </Field>
            {error && <div className="error">{error}</div>}
            {taken && (
              <div className="notice">A profile named “{taken.name}” already exists. Pick another name, or {onOpen ? <button type="button" className="link" onClick={() => onOpen(taken.id)}>open the existing one</button> : "open it from the profile menu"}.</div>
            )}
            <div className="modal-actions">
              <span />
              <span className="spacer" />
              <button type="button" className="btn primary" disabled={busy} onClick={() => void next()}>{busy ? "…" : "Next"}</button>
            </div>
          </div>
        ) : draft ? (
          <AgentIntake profile={draft} doc={draft.pendingIntake?.[0]} name={draft.name?.trim() || name} create busy={busy} error={error} onFinish={finish} scope={scope} onBack={() => void back()} handshake={{ profile: draftId!, since }} />
        ) : (
          <div className="modal-body"><div className="muted">Loading…</div></div>
        )}
      </div>
    </div>
  );
}

function AgentIntake({ profile, doc, name, create, busy, error, onFinish, scope, onBack, handshake, onDone, onHistory }: { profile: Profile; doc?: PendingIntake; name: string; create: boolean; busy: boolean; error: string | null; onFinish: (edits: ProfileEdit[], provided?: Set<string>, awaitAgent?: boolean) => Promise<void>; scope: string; onBack?: () => void; handshake?: { profile: string; since: number }; onDone?: () => void; onHistory?: () => void }) {
  const onInteract = undefined as (() => void) | undefined;
  // With Claude connected, its writes land in the profile directly; this pane shows what has arrived since the dialog opened.
  const [openedAt] = useState(() => new Date().toISOString());
  const [arrived, setArrived] = useState<HistoryRow[]>([]);
  const profileId = useContext(ProfileIdContext);
  const canFinish = true;
  const [sections, setSections] = useState<IntakeSection[]>(DOCUMENT_SECTIONS);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"agent" | "copy">(() => loadDraft(`${scope}.mode`, { mode: "agent" as const }).mode);
  const live = mode === "agent" && !create;
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const tick = () => api.history(profileId).then((rows) => { if (!cancelled) setArrived(rows.filter((r) => r.actor !== "you" && r.at > openedAt)); }).catch(() => {});
    tick();
    const h = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(h); };
  }, [live, profileId, openedAt]);
  const [ready, setReady] = useState(false);
  useEffect(() => { saveDraft(`${scope}.mode`, { mode }); }, [scope, mode]);
  const sent = doc;
  const [pasted, setPasted] = useState(() => sent?.text ?? loadDraft(`${scope}.paste`, { text: "" }).text);
  useEffect(() => { saveDraft(`${scope}.paste`, { text: pasted }); }, [scope, pasted]);
  // A document the connected agent sends while this is open lands in the review on its own.
  useEffect(() => { if (sent?.text) { setPasted(sent.text); setAccepted(null); } }, [sent?.text]);
  const agent = useAgentStatus();
  const [accepted, setAccepted] = useState<Set<string> | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [showSame, setShowSame] = useState(false);

  const prompt = useMemo(() => intakePrompt({ sections, profile }), [sections, profile]);
  const parsed = useMemo(() => (pasted.trim() ? parseIntake(pasted) : null), [pasted]);
  const review = useMemo(() => (parsed?.doc ? reviewIntake(parsed.doc, profile) : null), [parsed, profile]);
  const selected = useMemo(() => {
    if (!review) return new Set<string>();
    return accepted ?? new Set(review.changes.filter((c) => c.status !== "same").map((c) => c.id));
  }, [review, accepted]);

  const copy = async () => {
    onInteract?.();
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked; the textarea is selectable */ }
  };
  const edits = (): ProfileEdit[] => {
    if (!review) return [];
    const out = changesToEdits(review.changes.filter((c) => selected.has(c.id)), profile);
    for (const u of review.unknown) {
      const raw = typed[u.path];
      if (!raw?.trim()) continue;
      const path = profilePathForIntake(u.path);
      if (!path) continue;
      const value = path.join(".") === "filer.dependents"
        ? raw.split(/[,\s]+/).filter(Boolean).map((t) => (/^\d{4}$/.test(t) ? { birthYear: Number(t) } : {}))
        : (parseAmount(raw) ?? raw.trim());
      out.push({ path, value });
      out.push({ path: ["sources", path.join(".")], value: "typed in during intake" });
    }
    out.push(...followUpEdits(review, profile));
    return out;
  };

  const visible = review ? review.changes.filter((c) => showSame || c.status !== "same") : [];
  const grouped = INTAKE_SECTIONS.map((s) => ({ section: s, rows: visible.filter((c) => c.section === s.id) })).filter((g) => g.rows.length);
  const sameCount = review ? review.changes.filter((c) => c.status === "same").length : 0;
  const changeCount = selected.size;
  const hasTyped = Object.values(typed).some((v) => v.trim());
  const sectionLabel = sections.length === INTAKE_SECTIONS.length ? "Everything" : sections.length === DOCUMENT_SECTIONS.length && DOCUMENT_SECTIONS.every((s) => sections.includes(s)) ? "Documents only" : `${sections.length} of ${INTAKE_SECTIONS.length} sections`;

  const finishButton = (
    <button type="button" id="create-profile" className="btn primary" disabled={busy || !canFinish || (!create && changeCount === 0 && !hasTyped)} onClick={() => void onFinish(edits(), new Set((review?.changes ?? []).filter((c) => c.proposed !== undefined && c.proposed !== "" && !(c.id === "people.self.salary" && c.proposed === 0)).map((c) => c.id)), create && !review)}>
      {busy ? "…" : create ? (review ? "Create profile" : "Create now, add numbers later") : review ? `Apply ${changeCount} value${changeCount === 1 ? "" : "s"}` : "Apply"}
    </button>
  );
  const toggle = <Segmented options={[{ value: "agent", label: "With Claude" }, { value: "copy", label: "Paste a reply" }]} value={mode} onChange={(m) => { onInteract?.(); setMode(m); }} />;

  if (create && mode === "agent" && handshake) {
    return (
      <div className="modal-body">
        {toggle}
        <AgentSetup status={agent} name={name} create expect={handshake} onConnected={() => setReady(true)} />
        {error && <div className="error">{error}</div>}
        {ready && <div className="notice good">Connected.</div>}
        <div className="modal-actions">
          {onBack && !ready && <button type="button" className="btn" onClick={onBack}>Back</button>}
          <span className="muted small" style={{ margin: 0 }}>{ready ? "" : ""}</span>
          <span className="spacer" />
          {ready
            ? <button type="button" className="btn primary" disabled={busy} onClick={() => void onFinish([], new Set(), false)}>Open my plan</button>
            : <button type="button" className="btn" disabled={busy} onClick={() => void onFinish([], new Set(), true)}>Skip for now</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-body">
      {toggle}
      <div className="two-col">
        <div className="col">
          {mode === "agent" ? (
            <AgentSetup status={agent} name={name} create={create} />
          ) : (
            <>
              <div className="col-title"><span className="step-no">1</span> Give this to Claude, or any assistant that can read your files</div>
              <p className="muted small">Claude with Drive or mail, ChatGPT with uploads, or a coding assistant in a folder. Paste its reply into step 2.</p>
              <textarea className="prompt-box" readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} />
              <div className="modal-actions">
                <button type="button" className="btn primary" disabled={sections.length === 0} onClick={() => void copy()}>{copied ? "Copied" : "Copy request"}</button>
                <details className="sections-details">
                  <summary>Asking for: {sectionLabel.toLowerCase()}</summary>
                  <ul>
                    {INTAKE_SECTIONS.map((s) => (
                      <li key={s.id}><label><input type="checkbox" checked={sections.includes(s.id)} onChange={() => setSections((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))} /> <strong>{s.title}</strong> <span className="muted">{s.documents}</span></label></li>
                    ))}
                  </ul>
                </details>
              </div>
            </>
          )}
        </div>
        {live ? (
          <div className="col">
            <div className="col-title"><span className="step-no">✓</span> What arrived</div>
            {arrived.length === 0
              ? <div className="agent-status"><span className="dot pulse" /> Nothing yet.</div>
              : <ul className="plain arrived">{arrived.slice(0, 12).map((r) => <li key={r.at}><span className="muted small">{new Date(r.at).toLocaleTimeString()} · {r.actor} · </span>{demoText(r.lines.join("; "))}</li>)}</ul>}
            {onHistory && <button type="button" className="link" onClick={onHistory}>Full history, with undo</button>}
          </div>
        ) : (
        <div className="col">
          <div className="col-title"><span className="step-no">{mode === "agent" ? "✓" : "2"}</span> Review what was found</div>
          {sent && pasted === sent.text && <div className="muted small">Sent by Claude {new Date(sent.submitted).toLocaleString()}.</div>}
          {mode === "agent" && !sent && !pasted.trim() && <div className="agent-status"><span className="dot pulse" /> Waiting for Claude…</div>}
          <textarea className="paste-box" placeholder={mode === "agent" ? "Claude's reply appears here on its own." : "Paste the whole reply here."} value={pasted} onChange={(e) => { onInteract?.(); setPasted(e.target.value); setAccepted(null); }} />
          {parsed && parsed.problems.length > 0 && (
            <div className="error">
              Could not read the reply:
              <ul>{parsed.problems.map((p, i) => <li key={i}><code>{p.path || "document"}</code> {p.message}</li>)}</ul>
            </div>
          )}
          {parsed && parsed.doc && parsed.warnings.length > 0 && <div className="muted small">Read with small corrections: {parsed.warnings.map((w) => `${w.path} (${w.message})`).join("; ")}.</div>}
          {!review && <p className="muted small">{create ? "Create the profile now; numbers can arrive later." : "What changed shows here before anything is saved."}</p>}
        </div>
        )}
      </div>

      {review && (
        <div className="found">
          <div className="found-head">
            <strong>Found {review.changes.filter((c) => c.status !== "same").length} values</strong>
            <span className="muted">{INTAKE_SECTIONS.map((s) => ({ s, n: review.changes.filter((c) => c.section === s.id && c.status !== "same").length })).filter((x) => x.n).map((x) => `${SHORT[x.s.id] ?? x.s.title} ${x.n}`).join(" · ")}</span>
            {review.questions.length > 0 && <span className="pill">{review.questions.length} to double-check later</span>}
          </div>
          <details className="found-details">
            <summary>See them{sameCount > 0 ? ` (${sameCount} unchanged hidden)` : ""}</summary>
            {sameCount > 0 && <button type="button" className="link" onClick={() => setShowSame((v) => !v)}>{showSame ? "hide" : "show"} unchanged</button>}
            <div className="table-wrap">
              <table className="review">
                <thead><tr><th></th><th>Field</th><th>{create ? "Default" : "Now"}</th><th>{create ? "From your documents" : "Proposed"}</th><th>Source</th></tr></thead>
                <tbody>
                  {grouped.map((g) => [
                    <tr key={g.section.id} className="group"><td colSpan={5}>{g.section.title}</td></tr>,
                    ...g.rows.map((c) => (
                      <tr key={c.id} className={c.status}>
                        <td><input type="checkbox" checked={selected.has(c.id)} disabled={c.status === "same"} onChange={() => setAccepted((prev) => { const next = new Set(prev ?? selected); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; })} /></td>
                        <td>{c.label}{c.note && <span className="muted"> · {c.note}</span>}</td>
                        <td className="mono">{fmt(c.current, c.format)}</td>
                        <td className="mono proposed">{fmt(c.proposed, c.format)}</td>
                        <td className="source-cell">{c.source ?? <span className="muted">no source given</span>}</td>
                      </tr>
                    )),
                  ])}
                  {review.unknown.length > 0 && <tr className="group"><td colSpan={5}>Not found in your documents</td></tr>}
                  {review.unknown.map((u) => (
                    <tr key={u.path} className="unknown">
                      <td></td>
                      <td>{u.label}</td>
                      <td className="muted">unknown</td>
                      <td><span className="input-wrap"><input placeholder="type it" value={typed[u.path] ?? ""} onChange={(e) => setTyped((t) => ({ ...t, [u.path]: e.target.value }))} /></span></td>
                      <td className="muted">{profilePathForIntake(u.path) ? "typed by you" : "not a profile field"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        {onBack && <button type="button" className="btn" onClick={onBack}>Back</button>}
        <span className="muted small" style={{ margin: 0 }}>{live ? "Every change is logged and can be undone from History." : review?.questions.length ? "Claude's notes are under Edit my information." : "Every number keeps its source."}</span>
        <span className="spacer" />
        {live ? <button type="button" className="btn primary" onClick={onDone}>Done</button> : finishButton}
      </div>
    </div>
  );
}

function fmt(v: unknown, format: IntakeChange["format"]): string {
  if (v === undefined || v === null) return "";
  switch (format) {
    case "usd": return typeof v === "number" ? (Number.isInteger(v) ? usd(v) : `$${v.toFixed(2)}`) : String(v);
    case "pct": return typeof v === "number" ? pct(v) : String(v);
    case "shares": return typeof v === "number" ? shares(v) : String(v);
    case "number": return typeof v === "number" ? v.toLocaleString("en-US") : String(v);
    case "grant": {
      const g = v as { type: string; granted: number; strike?: number; vestedToDate?: number; exercisedToDate?: number; schedule?: { years: number; cadence?: string; start: string; cliffMonths?: number }; vesting?: Record<string, number> };
      const parts = [`${g.type.toUpperCase()} · ${shares(g.granted)} granted`];
      if (g.strike !== undefined) parts.push(`strike ${usd(g.strike)}`);
      if (g.vestedToDate !== undefined) parts.push(`${shares(g.vestedToDate)} vested`);
      if (g.exercisedToDate) parts.push(`${shares(g.exercisedToDate)} exercised`);
      if (g.schedule) parts.push(`${g.schedule.years}y ${g.schedule.cadence ?? "monthly"} from ${g.schedule.start}${g.schedule.cliffMonths ? `, ${g.schedule.cliffMonths}mo cliff` : ""}`);
      else if (g.vesting) parts.push("vests " + Object.entries(g.vesting).map(([y, n]) => `${shares(n)} in ${y}`).join(", "));
      return parts.join(" · ");
    }
    case "companies": return (v as { name: string; sharePrice: number }[]).map((c) => `${c.name} at ${usd(c.sharePrice)}/sh`).join("; ");
    case "events": return (v as { kind: string; type?: string; shares: number; year: number; date?: string }[]).map((e) => `${e.kind === "exercise" ? `exercise ${shares(e.shares)} ${e.type?.toUpperCase()}` : `${e.kind} ${shares(e.shares)}`} ${e.date ?? e.year}`).join("; ");
    case "holdings": {
      const lots = v as { lot: string; quantity: number; costBasis: number; amtBasis?: number }[];
      return lots.map((l) => `${l.lot}: ${shares(l.quantity)} sh, basis ${usd(l.costBasis)}${l.amtBasis !== undefined ? ` / AMT ${usd(l.amtBasis)}` : ""}`).join("; ");
    }
    case "mortgage": {
      const m = v as { balance: number; rate: number; originated: string; originalAmount?: number };
      return `${usd(m.balance)} at ${pct(m.rate)}, from ${m.originated}${m.originalAmount ? `, originally ${usd(m.originalAmount)}` : ""}`;
    }
    case "priorReturn": {
      const r = v as { year: number; reported: { agi?: number; totalTax?: number; amt?: number } };
      return [`${r.year}`, r.reported.agi !== undefined && `AGI ${usd(r.reported.agi)}`, r.reported.totalTax !== undefined && `total tax ${usd(r.reported.totalTax)}`, r.reported.amt !== undefined && `AMT ${usd(r.reported.amt)}`].filter(Boolean).join(" · ");
    }
    default: return String(v);
  }
}
