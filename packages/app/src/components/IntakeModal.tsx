import { useEffect, useMemo, useState } from "react";
import { changesToEdits, DOCUMENT_SECTIONS, editProfileText, followUpEdits, intakePrompt, INTAKE_SECTIONS, parseIntake, parseProfile, profilePathForIntake, reviewIntake, stringifyProfile, type IntakeChange, type IntakeSection, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, shares, usd } from "../format.ts";
import { Field, parseAmount } from "./fields.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

interface FillProps { mode: "fill"; profile: Profile; onApply: (edits: ProfileEdit[]) => void; onClose: () => void; }
interface CreateProps { mode: "create"; onCreate: (name: string, text: string) => Promise<void>; onClose?: () => void; }
type Props = FillProps | CreateProps;

interface Basics { name: string }
const REQUIRED_BASICS: { id: string; text: string; about: string }[] = [
  { id: "filer.filingStatus", text: "How do you file? Single, married filing jointly, separately, or head of household.", about: "filer.filingStatus" },
  { id: "filer.state", text: "Which state do you live in?", about: "filer.state" },
  { id: "people.self.salary", text: "What is your base salary? Base pay only; equity income is added from your grants.", about: "people.self.salary" },
];

const thisYear = () => Math.max(2026, new Date().getFullYear());
const SHORT: Partial<Record<IntakeSection, string>> = { basics: "Filing", pay: "Pay", prior_return: "Last return", income: "Income", equity: "Equity", home: "Home", assumptions: "Assumptions" };

function profileTextFrom(b: Basics): string {
  return stringifyProfile({
    version: 3, name: b.name.trim() || "New profile",
    filer: { filingStatus: "single", state: "WA", dependents: [] },
    plan: { startYear: thisYear(), years: 6 },
    assumptions: { inflation: 0.025, wageGrowth: 0.03, fmvGrowth: 0.1 },
    people: { self: { salary: 0 } },
    income: {}, carryforwards: {}, equity: { companies: [], grants: [], holdings: [] }, home: {}, deductions: {},
    timeline: [], scenarios: { default: { exercises: { iso: {}, nso: {} } } }, activeScenario: "default",
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
  const create = props.mode === "create";
  const scope = create ? "new" : `fill.${props.profile.name ?? ""}`;
  const [basics, setBasics] = useState<Basics>(() => loadDraft(`${scope}.basics`, { name: "Me" }));
  useEffect(() => { if (create) saveDraft(`${scope}.basics`, basics); }, [create, scope, basics]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameNeeded, setNameNeeded] = useState(false);
  const set = <K extends keyof Basics>(k: K, v: Basics[K]) => setBasics((b) => ({ ...b, [k]: v }));
  const nameMissing = create && basics.name.trim() === "";

  const baseText = useMemo(() => (create ? profileTextFrom(basics) : null), [create, basics]);
  const profile: Profile = useMemo(() => (props.mode === "fill" ? props.profile : parseProfile(baseText!)), [props, baseText]);
  const canCreate = true;
  const onClose = props.onClose;

  const finish = async (edits: ProfileEdit[], provided: Set<string> = new Set()) => {
    if (nameMissing) {
      setNameNeeded(true);
      document.getElementById("profile-name")?.focus();
      return;
    }
    if (props.mode === "fill") {
      props.onApply(edits);
      clearDraft(`${scope}.paste`);
      props.onClose();
      return;
    }
    setBusy(true);
    setError(null);
    // Whatever the agent did not supply is asked on the main screen, not here.
    const text = editProfileText(baseText!, edits);
    const missing = REQUIRED_BASICS.filter((b) => !provided.has(b.id)).map((b, i) => ({ id: `m${i + 1}`, text: b.text, about: b.about, kind: "missing" as const, added: new Date().toISOString().slice(0, 10) }));
    const existing = parseProfile(text).followUps ?? [];
    const withMissing = missing.length ? editProfileText(text, [{ path: ["followUps"], value: [...missing, ...existing] }]) : text;
    try { await props.onCreate(basics.name.trim() || "New profile", withMissing); clearDraft(`${scope}.basics`); clearDraft(`${scope}.paste`); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal intake-modal wide" role="dialog" aria-modal="true" aria-label={create ? "New profile" : "Fill from documents"}>
        <header className="modal-head">
          <div>
            <h3>{create ? "New profile" : "Fill from documents"}</h3>
            <div className="muted small" style={{ margin: 0 }}>{create ? "Name it. Your agent reads the rest from your documents; anything missing is asked afterward." : "Your agent reads the documents. You approve the numbers."}</div>
          </div>
          {create && !onClose && <ThemeToggle />}
          {onClose && <button type="button" className="btn icon" onClick={onClose} aria-label="Close">×</button>}
        </header>

        {create && (
          <div className="modal-body create-head">
            <div className="create-basics">
              <Field label="Name" hint="a person, a household, or a what-if" wide error={nameNeeded && nameMissing ? "Name this profile to continue." : undefined}><span className="input-wrap"><input id="profile-name" autoFocus value={basics.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Me, or Us if we marry in 2027" onFocus={(e) => e.currentTarget.select()} /></span></Field>
            </div>
          </div>
        )}

        <AgentIntake profile={profile} create={create} busy={busy} error={error} canFinish={true} onFinish={finish} scope={scope} onInteract={() => { if (nameMissing) setNameNeeded(true); }} />
      </div>
    </div>
  );
}

function AgentIntake({ profile, create, busy, error, canFinish, onFinish, scope, onInteract }: { profile: Profile; create: boolean; busy: boolean; error: string | null; canFinish: boolean; onFinish: (edits: ProfileEdit[], provided?: Set<string>) => Promise<void>; scope: string; onInteract?: () => void }) {
  const [sections, setSections] = useState<IntakeSection[]>(DOCUMENT_SECTIONS);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState(() => loadDraft(`${scope}.paste`, { text: "" }).text);
  useEffect(() => { saveDraft(`${scope}.paste`, { text: pasted }); }, [scope, pasted]);
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
      const n = parseAmount(raw);
      out.push({ path, value: n ?? raw.trim() });
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

  return (
    <div className="modal-body">
      <div className="two-col">
        <div className="col">
          <div className="col-title"><span className="step-no">1</span> Give this to your agent</div>
          <p className="muted small">Any agent that can see your files: Claude with Drive or mail, ChatGPT with uploads, a CLI agent in a folder. It reads your documents, asks you about gaps, and returns one block of YAML.</p>
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
        </div>
        <div className="col">
          <div className="col-title"><span className="step-no">2</span> Paste the reply here</div>
          <textarea className="paste-box" placeholder="The whole reply is fine." value={pasted} onChange={(e) => { onInteract?.(); setPasted(e.target.value); setAccepted(null); }} />
          {parsed && parsed.problems.length > 0 && (
            <div className="error">
              Not quite the expected shape:
              <ul>{parsed.problems.map((p, i) => <li key={i}><code>{p.path || "document"}</code> {p.message}</li>)}</ul>
            </div>
          )}
          {parsed && parsed.doc && parsed.warnings.length > 0 && <div className="muted small">Read with small corrections: {parsed.warnings.map((w) => `${w.path} (${w.message})`).join("; ")}.</div>}
          {!review && <p className="muted small">{create ? "You can also skip this now and do it later from the sidebar." : "What changed will show here before anything is saved."}</p>}
        </div>
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
        <span className="muted small" style={{ margin: 0 }}>{review?.questions.length ? "Your agent's notes will wait for you on the main screen." : "Every number keeps its source."}</span>
        <span className="spacer" />
        <button type="button" className="btn primary" disabled={busy || !canFinish || (!create && changeCount === 0 && !hasTyped)} onClick={() => void onFinish(edits(), new Set([...selected].filter((id) => review?.changes.find((c) => c.id === id && c.proposed !== 0 && c.proposed !== ""))))}>
          {busy ? "Creating…" : create ? "Create profile" : review ? `Apply ${changeCount} value${changeCount === 1 ? "" : "s"}` : "Apply"}
        </button>
      </div>
    </div>
  );
}

function fmt(v: unknown, format: IntakeChange["format"]): string {
  if (v === undefined || v === null) return "";
  switch (format) {
    case "usd": return typeof v === "number" ? usd(v) : String(v);
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
