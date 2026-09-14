import { useMemo, useState } from "react";
import { changesToEdits, intakePrompt, INTAKE_SECTIONS, parseIntake, profilePathForIntake, reviewIntake, type IntakeChange, type IntakeSection, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, shares, usd } from "../format.ts";
import { parseAmount } from "./fields.tsx";

interface Props { profile: Profile; onApply: (edits: ProfileEdit[]) => void; onClose: () => void; }

type Step = 1 | 2 | 3;

export function IntakeModal({ profile, onApply, onClose }: Props) {
  const [step, setStep] = useState<Step>(1);
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

  const apply = () => {
    if (!review) return;
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
    onApply(edits);
    onClose();
  };

  const visible = review ? review.changes.filter((c) => showSame || c.status !== "same") : [];
  const grouped = INTAKE_SECTIONS.map((s) => ({ section: s, rows: visible.filter((c) => c.section === s.id) })).filter((g) => g.rows.length);
  const sameCount = review ? review.changes.filter((c) => c.status === "same").length : 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal intake-modal" role="dialog" aria-modal="true" aria-label="Fill from documents">
        <header className="modal-head">
          <div>
            <h3>Fill from documents</h3>
            <div className="muted small" style={{ margin: 0 }}>Your agent reads the documents; you approve every number.</div>
          </div>
          <nav className="steps">
            {([1, 2, 3] as Step[]).map((n) => <button key={n} type="button" className={"step" + (step === n ? " on" : "")} onClick={() => setStep(n)}><span className="step-no">{n}</span>{["Choose", "Copy the request", "Paste and review"][n - 1]}</button>)}
          </nav>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">×</button>
        </header>

        {step === 1 && (
          <div className="modal-body">
            <p className="lede">Pick what to gather. Each section lists the documents your agent will need to read or have access to.</p>
            <ul className="section-list">
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
            <div className="modal-actions"><span className="spacer" /><button type="button" className="btn primary" disabled={sections.length === 0} onClick={() => setStep(2)}>Next: the request</button></div>
          </div>
        )}

        {step === 2 && (
          <div className="modal-body">
            <p className="lede">Paste this into any agent that can see your documents (Claude, ChatGPT, a CLI agent pointed at a folder). It returns one YAML document; bring that back to step 3.</p>
            <textarea className="prompt-box" readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} />
            <div className="modal-actions">
              <button type="button" className="btn primary" onClick={() => void copy()}>{copied ? "Copied" : "Copy request"}</button>
              <button type="button" className="btn" onClick={download}>Download .md</button>
              <span className="muted small" style={{ margin: 0 }}>{prompt.split(/\s+/).length.toLocaleString()} words · includes your current profile so re-runs come back complete</span>
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setStep(3)}>Next: paste the result</button>
            </div>
          </div>
        )}

        {step === 3 && (
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
                <div className="modal-actions">
                  <button type="button" className="btn primary" disabled={selected.size === 0 && !Object.values(typed).some((v) => v.trim())} onClick={apply}>Apply {selected.size} change{selected.size === 1 ? "" : "s"}</button>
                  <button type="button" className="btn" onClick={onClose}>Cancel</button>
                  <span className="spacer" />
                  <span className="muted small" style={{ margin: 0 }}>Sources are kept with each number.</span>
                </div>
              </>
            )}
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
      const g = v as { type: string; shares: number; strike?: number; vested?: number; schedule?: { years: number; cadence?: string; start: string; cliffMonths?: number }; vesting?: Record<string, number> };
      const parts = [`${g.type.toUpperCase()} · ${shares(g.shares)} sh`];
      if (g.strike !== undefined) parts.push(`strike ${usd(g.strike)}`);
      if (g.vested !== undefined) parts.push(`${shares(g.vested)} vested`);
      if (g.schedule) parts.push(`${g.schedule.years}y ${g.schedule.cadence ?? "monthly"} from ${g.schedule.start}${g.schedule.cliffMonths ? `, ${g.schedule.cliffMonths}mo cliff` : ""}`);
      else if (g.vesting) parts.push("vests " + Object.entries(g.vesting).map(([y, n]) => `${shares(n)} in ${y}`).join(", "));
      return parts.join(" · ");
    }
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
