import { useMemo, useState } from "react";
import { changesToEdits, editProfileText, intakePrompt, INTAKE_SECTIONS, parseIntake, parseProfile, profilePathForIntake, reviewIntake, stringifyProfile, type FilingStatus, type IntakeChange, type IntakeSection, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, shares, usd } from "../format.ts";
import { FILING_OPTIONS, Field, MoneyInput, Segmented, Select, STATE_OPTIONS, parseAmount } from "./fields.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

interface FillProps { mode: "fill"; profile: Profile; onApply: (edits: ProfileEdit[]) => void; onClose: () => void; }
interface CreateProps { mode: "create"; onCreate: (name: string, text: string) => Promise<void>; onClose?: () => void; }
type Props = FillProps | CreateProps;

/** A minimal, valid profile to start a new one from. */
export function blankProfileText(name: string, filingStatus: FilingStatus, state: string, salary: number): string {
  const year = new Date().getFullYear();
  return stringifyProfile({
    version: 3, name, filer: { filingStatus, state, dependents: [] }, plan: { startYear: Math.max(2026, year), years: 6 },
    assumptions: { inflation: 0.025, wageGrowth: 0.03, fmvGrowth: 0.1 },
    people: { self: { salary } }, income: {}, carryforwards: {}, equity: { companies: [], grants: [], holdings: [] }, home: {}, deductions: {},
    timeline: [], scenarios: { default: { exercises: { iso: {}, nso: {} } } }, activeScenario: "default",
  });
}

export function IntakeModal(props: Props) {
  const create = props.mode === "create";
  const [name, setName] = useState("");
  const [start, setStart] = useState<"agent" | "manual" | null>(create ? null : "agent");
  const [filingStatus, setFilingStatus] = useState<FilingStatus>("single");
  const [state, setState] = useState("WA");
  const [salary, setSalary] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseText = useMemo(() => (create ? blankProfileText(name.trim() || "New profile", filingStatus, state, salary) : null), [create, name, filingStatus, state, salary]);
  const profile: Profile = useMemo(() => (props.mode === "fill" ? props.profile : parseProfile(baseText!)), [props, baseText]);
  const canCreate = !create || name.trim() !== "";
  const onClose = props.onClose;

  const finish = async (edits: ProfileEdit[]) => {
    if (props.mode === "fill") {
      props.onApply(edits);
      props.onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try { await props.onCreate(name.trim() || "New profile", editProfileText(baseText!, edits)); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={"modal intake-modal" + (start === "agent" ? " wide" : "")} role="dialog" aria-modal="true" aria-label={create ? "New profile" : "Fill from documents"}>
        <header className="modal-head">
          <div>
            <h3>{create ? "New profile" : "Fill from documents"}</h3>
            <div className="muted small" style={{ margin: 0 }}>{create ? "A profile is a person, a household, or a what-if. It lives in a file you can edit." : "Your agent reads the documents; you approve every number."}</div>
          </div>
          {create && !onClose && <ThemeToggle />}
          {create && start && <button type="button" className="btn" onClick={() => setStart(null)}>Back</button>}
          {onClose && <button type="button" className="btn icon" onClick={onClose} aria-label="Close">×</button>}
        </header>

        {create && (
          <div className="modal-body create-head">
            <Field label="Name" wide><span className="input-wrap"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Me, or Us if we marry in 2027" /></span></Field>
          </div>
        )}

        {create && start === null && (
          <div className="modal-body">
            <div className="start-cards">
              <button type="button" className="start-card" disabled={!canCreate} onClick={() => setStart("agent")}>
                <strong>From my documents</strong>
                <span>Copy one request into an agent that can see your tax return and equity portal. Paste back what it finds; approve each number.</span>
                <em>Recommended</em>
              </button>
              <button type="button" className="start-card" disabled={!canCreate} onClick={() => setStart("manual")}>
                <strong>By hand</strong>
                <span>Four fields now. Everything else has a place in the sidebar.</span>
              </button>
            </div>
            {!canCreate && <div className="muted small">Give it a name first.</div>}
          </div>
        )}

        {create && start === "manual" && (
          <div className="modal-body">
            <div className="create-basics">
              <Field label="Filing status" wide><Segmented options={[...FILING_OPTIONS]} value={filingStatus} onChange={setFilingStatus} /></Field>
              <Field label="State"><Select options={STATE_OPTIONS} value={state} onChange={setState} /></Field>
              <Field label="Base salary" hint="320k works"><MoneyInput value={salary} onChange={setSalary} placeholder="0" /></Field>
            </div>
            {error && <div className="error">{error}</div>}
            <div className="modal-actions">
              <span className="spacer" />
              <button type="button" className="btn primary" disabled={!canCreate || busy} onClick={() => void finish([])}>{busy ? "Creating…" : "Create profile"}</button>
            </div>
          </div>
        )}

        {start === "agent" && <AgentIntake profile={profile} create={create} busy={busy} error={error} canFinish={canCreate} onFinish={finish} />}
      </div>
    </div>
  );
}

function AgentIntake({ profile, create, busy, error, canFinish, onFinish }: { profile: Profile; create: boolean; busy: boolean; error: string | null; canFinish: boolean; onFinish: (edits: ProfileEdit[]) => Promise<void> }) {
  const [sections, setSections] = useState<IntakeSection[]>(INTAKE_SECTIONS.map((s) => s.id));
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
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
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked; the textarea is selectable */ }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([prompt], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url; a.download = "taxonomy-intake-request.md"; a.click();
    URL.revokeObjectURL(url);
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
    return out;
  };

  const visible = review ? review.changes.filter((c) => showSame || c.status !== "same") : [];
  const grouped = INTAKE_SECTIONS.map((s) => ({ section: s, rows: visible.filter((c) => c.section === s.id) })).filter((g) => g.rows.length);
  const sameCount = review ? review.changes.filter((c) => c.status === "same").length : 0;
  const changeCount = selected.size;
  const hasTyped = Object.values(typed).some((v) => v.trim());

  return (
    <div className="modal-body">
      <div className="two-col">
        <div className="col">
          <div className="col-title"><span className="step-no">1</span> Copy this into your agent</div>
          <p className="muted small">Any agent that can see your documents: Claude with your Drive or mail, a CLI agent pointed at a folder of PDFs, ChatGPT with uploads. It returns one YAML document.</p>
          <textarea className="prompt-box" readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} />
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={() => void copy()}>{copied ? "Copied" : "Copy request"}</button>
            <button type="button" className="btn" onClick={download}>Download .md</button>
            <details className="sections-details">
              <summary>{sections.length === INTAKE_SECTIONS.length ? "Everything" : `${sections.length} of ${INTAKE_SECTIONS.length} sections`}</summary>
              <ul>
                {INTAKE_SECTIONS.map((s) => (
                  <li key={s.id}><label><input type="checkbox" checked={sections.includes(s.id)} onChange={() => setSections((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))} /> <strong>{s.title}</strong> <span className="muted">{s.documents}</span></label></li>
                ))}
              </ul>
            </details>
          </div>
        </div>
        <div className="col">
          <div className="col-title"><span className="step-no">2</span> Paste what it returns</div>
          <textarea className="paste-box" placeholder="Paste the YAML here…" value={pasted} onChange={(e) => { setPasted(e.target.value); setAccepted(null); }} />
          {parsed && parsed.problems.length > 0 && (
            <div className="error">
              Not quite the expected shape:
              <ul>{parsed.problems.map((p, i) => <li key={i}><code>{p.path || "document"}</code> {p.message}</li>)}</ul>
            </div>
          )}
          {parsed && parsed.doc && parsed.warnings.length > 0 && <div className="muted small">Read with small corrections: {parsed.warnings.map((w) => `${w.path} (${w.message})`).join("; ")}.</div>}
          {!review && <p className="muted small">The changes will show up here for you to approve.</p>}
        </div>
      </div>

      {review && (
        <>
          <div className="review-summary">
            <strong>{review.changes.filter((c) => c.status !== "same").length} {create ? "values found" : "changes"}</strong>
            {sameCount > 0 && <button type="button" className="link" onClick={() => setShowSame((v) => !v)}>{showSame ? "hide" : "show"} {sameCount} unchanged</button>}
            {review.asOf && <span className="muted">as of {review.asOf}</span>}
          </div>
          {review.questions.length > 0 && (
            <div className="questions">
              <div className="subhead">Still open after your agent asked</div>
              <ul>{review.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </div>
          )}
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
        </>
      )}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <span className="muted small" style={{ margin: 0 }}>Sources are kept with each number.</span>
        <span className="spacer" />
        {create && !review && <button type="button" className="btn" disabled={!canFinish || busy} onClick={() => void onFinish([])}>{busy ? "Creating…" : "Create now, paste later"}</button>}
        <button type="button" className="btn primary" disabled={busy || !canFinish || (!create && changeCount === 0 && !hasTyped) || (create && !review)} onClick={() => void onFinish(edits())}>
          {busy ? "Creating…" : create ? `Create profile with ${changeCount} value${changeCount === 1 ? "" : "s"}` : `Apply ${changeCount} change${changeCount === 1 ? "" : "s"}`}
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
