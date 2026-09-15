import { useMemo, useState } from "react";
import { changesToEdits, editProfileText, intakePrompt, INTAKE_SECTIONS, parseIntake, parseProfile, profilePathForIntake, reviewIntake, stringifyProfile, type FilingStatus, type IntakeChange, type IntakeSection, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, shares, usd } from "../format.ts";
import { FILING_OPTIONS, Field, MoneyInput, NumberInput, Segmented, Select, STATE_OPTIONS, parseAmount } from "./fields.tsx";

interface FillProps { mode: "fill"; profile: Profile; onApply: (edits: ProfileEdit[]) => void; onClose: () => void; }
interface CreateProps { mode: "create"; onCreate: (name: string, text: string) => Promise<void>; onClose?: () => void; }
type Props = FillProps | CreateProps;

type Step = 1 | 2;

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
  const [step, setStep] = useState<Step>(1);
  const [sections, setSections] = useState<IntakeSection[]>(INTAKE_SECTIONS.map((s) => s.id));
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const [accepted, setAccepted] = useState<Set<string> | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [showSame, setShowSame] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Create mode: the few facts a profile cannot exist without.
  const [name, setName] = useState("");
  const [filingStatus, setFilingStatus] = useState<FilingStatus>("single");
  const [state, setState] = useState("WA");
  const [salary, setSalary] = useState(0);
  const [start, setStart] = useState<"agent" | "manual">("agent");
  const [manual, setManual] = useState({ bonus: 0, pretax: 0, sharePrice: 0, isoShares: 0, isoStrike: 0, isoVested: 0 });

  const baseText = useMemo(() => {
    if (!create) return null;
    let text = blankProfileText(name.trim() || "New profile", filingStatus, state, salary);
    if (start === "manual") {
      const edits: ProfileEdit[] = [];
      if (manual.bonus) edits.push({ path: ["people", "self", "bonus"], value: manual.bonus });
      if (manual.pretax) edits.push({ path: ["people", "self", "pretaxContributions"], value: manual.pretax });
      if (manual.isoShares > 0 || manual.sharePrice > 0) edits.push({ path: ["equity", "companies"], value: [{ id: "c1", name: "Company", sharePrice: manual.sharePrice }] });
      if (manual.isoShares > 0) edits.push({ path: ["equity", "grants"], value: [{ id: "g1", name: "ISO grant", type: "iso", company: "c1", granted: manual.isoShares, vestedToDate: Math.min(manual.isoShares, manual.isoVested), strike: manual.isoStrike }] });
      if (edits.length) text = editProfileText(text, edits);
    }
    return text;
  }, [create, name, filingStatus, state, salary, start, manual]);
  const profile: Profile = useMemo(() => (props.mode === "fill" ? props.profile : parseProfile(baseText!)), [props, baseText]);

  const prompt = useMemo(() => intakePrompt({ sections, profile }), [sections, profile]);
  const parsed = useMemo(() => (pasted.trim() ? parseIntake(pasted) : null), [pasted]);
  const review = useMemo(() => (parsed?.doc ? reviewIntake(parsed.doc, profile) : null), [parsed, profile]);
  const selected = useMemo(() => {
    if (!review) return new Set<string>();
    return accepted ?? new Set(review.changes.filter((c) => c.status !== "same").map((c) => c.id));
  }, [review, accepted]);

  const toggleSection = (id: IntakeSection) => setSections((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked; the textarea is selectable */ }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([prompt], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url; a.download = "taxonomy-intake-request.md"; a.click();
    URL.revokeObjectURL(url);
  };

  const collectEdits = (): ProfileEdit[] => {
    if (!review) return [];
    const chosen = review.changes.filter((c) => selected.has(c.id));
    const edits = changesToEdits(chosen, profile);
    for (const u of review.unknown) {
      const raw = typed[u.path];
      if (!raw?.trim()) continue;
      const path = profilePathForIntake(u.path);
      if (!path) continue;
      const n = parseAmount(raw);
      edits.push({ path, value: n ?? raw.trim() });
      edits.push({ path: ["sources", path.join(".")], value: "typed in during intake" });
    }
    return edits;
  };

  const finish = async () => {
    const edits = collectEdits();
    if (props.mode === "fill") {
      props.onApply(edits);
      props.onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.onCreate(name.trim() || "New profile", editProfileText(baseText!, edits));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const visible = review ? review.changes.filter((c) => showSame || c.status !== "same") : [];
  const grouped = INTAKE_SECTIONS.map((s) => ({ section: s, rows: visible.filter((c) => c.section === s.id) })).filter((g) => g.rows.length);
  const sameCount = review ? review.changes.filter((c) => c.status === "same").length : 0;
  const canCreate = !create || name.trim() !== "";
  const onClose = props.onClose;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal intake-modal" role="dialog" aria-modal="true" aria-label={create ? "New profile" : "Fill from documents"}>
        <header className="modal-head">
          <div>
            <h3>{create ? "New profile" : "Fill from documents"}</h3>
            <div className="muted small" style={{ margin: 0 }}>{create ? "Name it, hand the request to your agent, paste back what it finds. Or create it empty and fill it later." : "Your agent reads the documents; you approve every number."}</div>
          </div>
          {(!create || start === "agent") && <nav className="steps">
            {([1, 2] as Step[]).map((n) => <button key={n} type="button" className={"step" + (step === n ? " on" : "")} onClick={() => setStep(n)}><span className="step-no">{n}</span>{["Choose and copy", "Paste and review"][n - 1]}</button>)}
          </nav>}
          {onClose && <button type="button" className="btn icon" onClick={onClose} aria-label="Close">×</button>}
        </header>

        {step === 1 && (
          <div className="modal-body">
            {create && (
              <div className="create-basics">
                <Field label="Profile name" hint="a person, a household, or a what-if" wide><span className="input-wrap"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Me, or Me if we marry in 2027" /></span></Field>
                <Field label="How to start" wide><Segmented options={[{ value: "agent", label: "With your agent and documents (recommended)" }, { value: "manual", label: "By hand" }]} value={start} onChange={setStart} /></Field>
                <Field label="Filing status" wide><Segmented options={[...FILING_OPTIONS]} value={filingStatus} onChange={setFilingStatus} /></Field>
                <Field label="State"><Select options={STATE_OPTIONS} value={state} onChange={setState} /></Field>
                <Field label="Base salary" hint="320k works"><MoneyInput value={salary} onChange={setSalary} placeholder="0" /></Field>
                {start === "manual" && (
                  <>
                    <Field label="Bonus"><MoneyInput value={manual.bonus} onChange={(n) => setManual({ ...manual, bonus: n })} /></Field>
                    <Field label="Pre-tax contributions" hint="401k, HSA"><MoneyInput value={manual.pretax} onChange={(n) => setManual({ ...manual, pretax: n })} /></Field>
                    <Field label="Share value" hint="per share, if you have equity"><MoneyInput value={manual.sharePrice} onChange={(n) => setManual({ ...manual, sharePrice: n })} decimals={2} /></Field>
                    <Field label="ISO shares granted" hint="optional; more grants later in the sidebar"><NumberInput value={manual.isoShares} onChange={(n) => setManual({ ...manual, isoShares: Math.round(n) })} min={0} /></Field>
                    <Field label="ISO strike"><MoneyInput value={manual.isoStrike} onChange={(n) => setManual({ ...manual, isoStrike: n })} decimals={2} /></Field>
                    <Field label="ISO shares vested"><NumberInput value={manual.isoVested} onChange={(n) => setManual({ ...manual, isoVested: Math.round(n) })} min={0} /></Field>
                  </>
                )}
              </div>
            )}
            {create && start === "manual" && (
              <div className="modal-actions">
                <span className="muted small" style={{ margin: 0 }}>Everything else (other income, home, giving, last return) has a field in the sidebar.</span>
                <span className="spacer" />
                <button type="button" className="btn primary" disabled={!canCreate || busy} onClick={() => void finish()}>{busy ? "Creating…" : "Create profile"}</button>
              </div>
            )}
            {(!create || start === "agent") && <div className="choose-copy">
              <div className="choose">
                <p className="lede">Pick what to gather. The request on the right updates as you choose.</p>
                <ul className="section-list one-col">
                  {INTAKE_SECTIONS.map((s) => (
                    <li key={s.id} className={sections.includes(s.id) ? "on" : ""}>
                      <label>
                        <input type="checkbox" checked={sections.includes(s.id)} onChange={() => toggleSection(s.id)} />
                        <span>
                          <strong>{s.title}</strong>
                          <span className="what">{s.what}</span>
                          <span className="docs">Documents: {s.documents}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="copy">
                <p className="lede">Paste this into any agent that can see your documents. It returns one YAML document; bring that to step 2.</p>
                <textarea className="prompt-box" readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} />
                <div className="modal-actions">
                  <button type="button" className="btn primary" disabled={sections.length === 0} onClick={() => void copy()}>{copied ? "Copied" : "Copy request"}</button>
                  <button type="button" className="btn" disabled={sections.length === 0} onClick={download}>Download .md</button>
                  <span className="muted small" style={{ margin: 0 }}>{prompt.split(/\s+/).length.toLocaleString()} words</span>
                </div>
              </div>
            </div>}
            {(!create || start === "agent") && (
              <div className="modal-actions">
                {create && <button type="button" className="btn" disabled={!canCreate || busy} onClick={() => void finish()}>{busy ? "Creating…" : "Create now, paste later"}</button>}
                <span className="spacer" />
                <button type="button" className="btn primary" disabled={!canCreate} onClick={() => setStep(2)}>Next: paste the result</button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="modal-body">
            <textarea className="paste-box" placeholder="Paste the YAML your agent returned…" value={pasted} onChange={(e) => { setPasted(e.target.value); setAccepted(null); }} />
            {parsed && parsed.problems.length > 0 && (
              <div className="error">
                Not quite the expected shape:
                <ul>{parsed.problems.map((p, i) => <li key={i}><code>{p.path || "document"}</code> {p.message}</li>)}</ul>
              </div>
            )}
            {parsed && parsed.warnings.length > 0 && parsed.doc && (
              <div className="muted small">Read with small corrections: {parsed.warnings.map((w) => `${w.path} (${w.message})`).join("; ")}.</div>
            )}
            {review && (
              <>
                <div className="review-summary">
                  <strong>{review.changes.filter((c) => c.status !== "same").length} changes</strong>
                  {sameCount > 0 && <button type="button" className="link" onClick={() => setShowSame((v) => !v)}>{showSame ? "hide" : "show"} {sameCount} unchanged</button>}
                  {review.asOf && <span className="muted">as of {review.asOf}</span>}
                </div>
                {review.questions.length > 0 && (
                  <div className="questions">
                    <div className="subhead">Your agent asked</div>
                    <ul>{review.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                  </div>
                )}
                <div className="table-wrap">
                  <table className="review">
                    <thead><tr><th></th><th>Field</th><th>Now</th><th>Proposed</th><th>Source</th></tr></thead>
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
              <button type="button" className="btn primary" disabled={busy || !canCreate || (!create && selected.size === 0 && !Object.values(typed).some((v) => v.trim()))} onClick={() => void finish()}>
                {busy ? "Creating…" : create ? (review ? `Create with ${selected.size} change${selected.size === 1 ? "" : "s"}` : "Create profile") : `Apply ${selected.size} change${selected.size === 1 ? "" : "s"}`}
              </button>
              <button type="button" className="btn" onClick={() => setStep(1)}>Back</button>
              <span className="spacer" />
              <span className="muted small" style={{ margin: 0 }}>Sources are kept with each number.</span>
            </div>
          </div>
        )}
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
