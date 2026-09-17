import { Info } from "./Info.tsx";
import { useState } from "react";
import { usePersisted } from "../persist.ts";
import { fieldByPath, getPath, parseBirthYears, profileGaps, type FilingStatus, type FollowUp, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, usd } from "../format.ts";
import { FILING_OPTIONS, MoneyInput, PercentInput, Segmented, Select, STATE_OPTIONS } from "./fields.tsx";

const SECTION_FOR: [RegExp, string][] = [
  [/^(filer|people|plan)\./, "You"],
  [/^(grants\.|holdings|companies\.)/, "Equity"],
  [/^income\./, "Other income"],
  [/^home\./, "Home"],
  [/^deductions\.charitable/, "Giving"],
  [/^deductions\./, "Other deductions"],
  [/^(carryforwards\.|returns)/, "Last return and carryforwards"],
  [/^assumptions\./, "Assumptions"],
];

/** Notes Claude left (for reading, not approving) and probable gaps versus last year, both under "Edit my information". */
export function secondLookCount(profile: Profile, dismissed: string[]): { notes: number; gaps: number } {
  return { notes: (profile.followUps ?? []).filter((f) => !f.resolved && f.kind !== "missing").length, gaps: profileGaps(profile).filter((g) => !dismissed.includes(g.id)).length };
}

/**
 * The main-screen card: only what the plan cannot do without (facts nobody supplied, answered
 * here). Judgment calls and probable gaps wait under "Edit my information" so the plan is not
 * buried under a checklist.
 */
export function FollowUps({ profile, edit, onSecondLook }: { profile: Profile; edit: (edits: ProfileEdit[]) => void; onSecondLook: () => void }) {
  const all = profile.followUps ?? [];
  const open = all.filter((f) => !f.resolved);
  const [dismissed] = usePersisted<string[]>("dismissedGaps", [], (v): v is string[] => Array.isArray(v));
  const [expanded, setExpanded] = usePersisted<boolean>("followUpsOpen", true, (v): v is boolean => typeof v === "boolean");
  const missing = open.filter((f) => f.kind === "missing");
  const later = secondLookCount(profile, dismissed).gaps;
  if (missing.length === 0 && later === 0) return null;
  const resolve = (id: string, extra: ProfileEdit[] = []) => edit([...extra, { path: ["followUps"], value: all.map((f) => (f.id === id ? { ...f, resolved: true } : f)) }]);
  if (missing.length === 0) {
    return <div className="muted small second-look">{later} thing{later === 1 ? "" : "s"} probably missing compared with last year, under <button type="button" className="link" onClick={onSecondLook}>Edit my information</button>.</div>;
  }
  return (
    <section className={"card followups" + (expanded ? "" : " folded")}>
      <button type="button" className="card-fold" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        <h2>A few things to fill in <span className="count">{missing.length}</span></h2>
        <span className="muted small fold-hint">Your documents didn't say; answer here and the picture updates</span>
        <svg className="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {expanded && <>
      <ul className="missing">{missing.map((f) => <MissingRow key={f.id} f={f} profile={profile} onAnswer={(edits) => resolve(f.id, edits)} />)}</ul>
      {later > 0 && <div className="muted small">{later} more probably missing compared with last year, under <button type="button" className="link" onClick={onSecondLook}>Edit my information</button>.</div>}
      </>}
    </section>
  );
}

function MissingRow({ f, profile, onAnswer }: { f: FollowUp; profile: Profile; onAnswer: (edits: ProfileEdit[]) => void }) {
  const [value, setValue] = useState<string | number>(f.about === "filer.filingStatus" ? profile.filer.filingStatus : f.about === "filer.state" ? profile.filer.state : f.about === "filer.dependents" ? (profile.filer.dependents ?? []).map((d) => d.birthYear ?? "").join(", ") : 0);
  const path = (f.about ?? "").split(".");
  const def = fieldByPath(f.about ?? "");
  const control =
    f.about === "filer.filingStatus" ? <Segmented options={[...FILING_OPTIONS]} value={value as FilingStatus} onChange={setValue} />
    : f.about === "filer.state" ? <Select options={STATE_OPTIONS} value={String(value)} onChange={setValue} />
    : f.about === "filer.dependents" ? <span className="input-wrap"><input value={String(value)} placeholder="e.g. 2019, 2022" onChange={(e) => setValue(e.target.value)} /></span>
    : fieldByPath(f.about ?? "")?.type === "text" ? <span className="input-wrap"><input value={String(value)} onChange={(e) => setValue(e.target.value)} /></span>
    : fieldByPath(f.about ?? "")?.type === "date" ? <span className="input-wrap"><input type="date" value={String(value || "")} onChange={(e) => setValue(e.target.value)} /></span>
    : fieldByPath(f.about ?? "")?.type === "pct" ? <PercentInput value={Number(value) || 0} onChange={setValue} />
    : <MoneyInput value={Number(value) || 0} onChange={setValue} placeholder="0" />;
  const ready = def?.essential ? Number(value) > 0 : true;
  const answer = f.about === "filer.dependents" ? parseBirthYears(String(value)) : value;
  return (
    <li className="missing-row">
      <div className="missing-text">{f.text}</div>
      <div className="missing-answer">
        {control}
        <button type="button" className="btn primary" disabled={!ready} onClick={() => onAnswer([{ path, value: answer }, { path: ["sources", f.about ?? ""], value: "answered in app" }])}>Save</button>
      </div>
    </li>
  );
}

/**
 * Notes Claude left while filling things in (judgment calls, reconciliations), shown for reading
 * beside the value each one concerns; nothing to approve. Probable gaps versus last year follow.
 */
export function NotesFromClaude({ profile, edit }: { profile: Profile; edit: (edits: ProfileEdit[]) => void }) {
  const all = profile.followUps ?? [];
  const notes = all.filter((f) => !f.resolved && f.kind !== "missing");
  const clear = (ids: string[]) => edit([{ path: ["followUps"], value: all.map((f) => (ids.includes(f.id) ? { ...f, resolved: true } : f)) }]);
  const sectionOf = (about?: string) => (about && SECTION_FOR.find(([re]) => re.test(about))?.[1]) ?? "General";
  const subject = (about?: string): { label: string; value?: string } => {
    if (!about) return { label: "" };
    const def = fieldByPath(about.replace(/^equity\.companies\.\d+\./, "equity.companies.0."));
    if (def) { const v = getPath(profile, about); return { label: def.label, value: v === undefined || v === "" ? undefined : typeof v === "number" ? (def.type === "usd" ? usd(v) : def.type === "pct" ? pct(v) : v.toLocaleString("en-US")) : String(v) }; }
    if (about.startsWith("grants.")) return { label: profile.equity.grants.find((g) => `grants.${g.id}` === about)?.name ?? "Grant" };
    if (about === "holdings") return { label: "Shares owned" };
    if (about === "home.mortgage") return { label: "Mortgage" };
    if (about === "returns") return { label: "Last return" };
    return { label: about };
  };
  const groups = new Map<string, FollowUp[]>();
  for (const f of notes) { const k = sectionOf(f.about); groups.set(k, [...(groups.get(k) ?? []), f]); }
  if (notes.length === 0) return <p className="muted">Nothing here. Notes Claude leaves while filling things in appear here, and beside the values they concern.</p>;
  return (
    <>
      {notes.length > 0 && (
        <>
          <div className="notes-head">
            <div>
              <div className="subhead">Notes from Claude</div>
              <p className="muted small" style={{ margin: 0 }}>How it read the documents and what it decided when they disagreed. For reading, not approving; each note also shows as ⓘ beside its value. Clear them when you have seen them.</p>
            </div>
            <button type="button" className="btn" onClick={() => clear(notes.map((f) => f.id))}>Clear all</button>
          </div>
          {[...groups.entries()].map(([section, list]) => (
            <div key={section} className="notes-group">
              <div className="notes-section">{section}</div>
              {list.map((f) => { const sj = subject(f.about); return (
                <div key={f.id} className="note-card">
                  <div className="note-subject"><b>{sj.label}</b>{sj.value !== undefined && <span className="note-value">{sj.value}</span>}</div>
                  <div className="note-text">{f.text}</div>
                  <button type="button" className="link muted note-clear" onClick={() => clear([f.id])}>Clear</button>
                </div>
              ); })}
            </div>
          ))}
        </>
      )}
    </>
  );
}

/** What the plan probably lacks: figures last year's return had, equity it cannot model as entered. One click fills each, or says it does not apply. */
export function ProbablyMissing({ profile, edit }: { profile: Profile; edit: (edits: ProfileEdit[]) => void }) {
  const [dismissed, setDismissed] = usePersisted<string[]>("dismissedGaps", [], (v): v is string[] => Array.isArray(v));
  const gaps = profileGaps(profile).filter((g) => !dismissed.includes(g.id));
  if (gaps.length === 0) return null;
  return (
    <>
      <div className="subhead">Probably missing</div>
      <ul className="gaps">
        {gaps.map((g) => (
          <li key={g.id} className="gap-row">
            <span>{g.text} <span className="where">· {g.section}</span></span>
            <span className="gap-actions">
              {g.fill && <button type="button" className="btn" onClick={() => edit(g.fill!.edits)}>{g.fill.label}</button>}
              <button type="button" className="link" onClick={() => setDismissed((d) => [...d, g.id])}>Not needed</button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
