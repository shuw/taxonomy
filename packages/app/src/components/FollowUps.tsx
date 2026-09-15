import { useState } from "react";
import { usePersisted } from "../persist.ts";
import { fieldByPath, profileGaps, type FilingStatus, type FollowUp, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { FILING_OPTIONS, MoneyInput, Segmented, Select, STATE_OPTIONS } from "./fields.tsx";

const SECTION_FOR: [RegExp, string][] = [
  [/^(filer|people|plan)\./, "You"],
  [/^(grants\.|holdings|companies\.)/, "Equity"],
  [/^income\./, "Other income"],
  [/^home\./, "Home"],
  [/^deductions\./, "Giving and deductions"],
  [/^(carryforwards\.|returns)/, "Last return and carryforwards"],
  [/^assumptions\./, "Assumptions"],
];

/** What the intake left open: facts nobody supplied (answered here) and judgment calls to confirm. */
export function FollowUps({ profile, edit }: { profile: Profile; edit: (edits: ProfileEdit[]) => void }) {
  const all = profile.followUps ?? [];
  const open = all.filter((f) => !f.resolved);
  const [dismissed, setDismissed] = usePersisted<string[]>("dismissedGaps", [], (v): v is string[] => Array.isArray(v));
  const [expanded, setExpanded] = usePersisted<boolean>("followUpsOpen", true, (v): v is boolean => typeof v === "boolean");
  const gaps = profileGaps(profile).filter((g) => !dismissed.includes(g.id));
  if (open.length === 0 && gaps.length === 0) return null;
  const count = open.length + gaps.length;
  const resolve = (id: string, extra: ProfileEdit[] = []) => edit([...extra, { path: ["followUps"], value: all.map((f) => (f.id === id ? { ...f, resolved: true } : f)) }]);
  const sectionOf = (about?: string) => about && SECTION_FOR.find(([re]) => re.test(about))?.[1];
  const missing = open.filter((f) => f.kind === "missing");
  const confirm = open.filter((f) => f.kind !== "missing");
  return (
    <section className={"card followups" + (expanded ? "" : " folded")}>
      <button type="button" className="card-fold" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        <h2>{missing.length ? "A few things to fill in" : confirm.length ? "Worth a second look" : "Probably missing"} <span className="count">{count}</span></h2>
        <svg className="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {!expanded && <div className="sub">{count === 1 ? "One item" : `${count} items`} waiting. Open to fill them in or dismiss them.</div>}
      {expanded && <>
      <div className="sub">{missing.length ? "Your documents didn't say. Answer here and the picture updates." : confirm.length ? "Your agent used its judgment on these. The numbers are already in; check them in the sidebar and tick each one off." : "Compared with your last return, these look left out. One click fills each in with last year's figure; dismiss the ones that no longer apply."}</div>
      {missing.length > 0 && <ul className="missing">{missing.map((f) => <MissingRow key={f.id} f={f} profile={profile} onAnswer={(edits) => resolve(f.id, edits)} />)}</ul>}
      {confirm.length > 0 && (
        <ul>
          {confirm.map((f) => (
            <li key={f.id}>
              <label>
                <input type="checkbox" checked={false} onChange={() => resolve(f.id)} />
                <span>{f.text}{sectionOf(f.about) && <span className="where"> · {sectionOf(f.about)}</span>}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {gaps.length > 0 && (
        <>
          {open.length > 0 && <div className="subhead" style={{ marginTop: 12 }}>Probably missing</div>}
          <ul className="gaps">
            {gaps.map((g) => (
              <li key={g.id} className="gap-row">
                <span>{g.text} <span className="where">· {g.section}</span></span>
                <span className="gap-actions">
                  {g.fill && <button type="button" className="btn" onClick={() => edit([{ path: g.fill!.path, value: g.fill!.value }, { path: ["sources", g.fill!.path.join(".")], value: g.fill!.source }])}>{g.fill.label}</button>}
                  <button type="button" className="link" onClick={() => setDismissed((d) => [...d, g.id])}>Not needed</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {all.length > open.length && <div className="muted small">{all.length - open.length} done.</div>}
      </>}
    </section>
  );
}

function MissingRow({ f, profile, onAnswer }: { f: FollowUp; profile: Profile; onAnswer: (edits: ProfileEdit[]) => void }) {
  const [value, setValue] = useState<string | number>(f.about === "filer.filingStatus" ? profile.filer.filingStatus : f.about === "filer.state" ? profile.filer.state : f.about === "filer.dependents" ? (profile.filer.dependents ?? []).map((d) => d.birthYear ?? "").join(", ") : 0);
  const path = (f.about ?? "").split(".");
  const control =
    f.about === "filer.filingStatus" ? <Segmented options={[...FILING_OPTIONS]} value={value as FilingStatus} onChange={setValue} />
    : f.about === "filer.state" ? <Select options={STATE_OPTIONS} value={String(value)} onChange={setValue} />
    : f.about === "filer.dependents" ? <span className="input-wrap"><input value={String(value)} placeholder="e.g. 2019, 2022" onChange={(e) => setValue(e.target.value)} /></span>
    : fieldByPath(f.about ?? "")?.type === "text" ? <span className="input-wrap"><input value={String(value)} onChange={(e) => setValue(e.target.value)} /></span>
    : <MoneyInput value={Number(value) || 0} onChange={setValue} placeholder="0" />;
  const ready = f.about === "people.self.salary" ? Number(value) > 0 : true;
  const answer = f.about === "filer.dependents" ? String(value).split(/[,\s]+/).filter(Boolean).map((t) => (/^\d{4}$/.test(t) ? { birthYear: Number(t) } : {})) : value;
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
