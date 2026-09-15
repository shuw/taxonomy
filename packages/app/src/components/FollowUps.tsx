import { useState } from "react";
import type { FilingStatus, FollowUp, Profile, ProfileEdit } from "@taxonomy/engine";
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
  if (open.length === 0) return null;
  const resolve = (id: string, extra: ProfileEdit[] = []) => edit([...extra, { path: ["followUps"], value: all.map((f) => (f.id === id ? { ...f, resolved: true } : f)) }]);
  const sectionOf = (about?: string) => about && SECTION_FOR.find(([re]) => re.test(about))?.[1];
  const missing = open.filter((f) => f.kind === "missing");
  const confirm = open.filter((f) => f.kind !== "missing");
  return (
    <section className="card followups">
      <h2>{missing.length ? "A few things to fill in" : "Worth a second look"}</h2>
      <div className="sub">{missing.length ? "Your documents didn't say. Answer here and the picture updates." : "Your agent used its judgment on these. The numbers are already in; check them in the sidebar and tick each one off."}</div>
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
      {all.length > open.length && <div className="muted small">{all.length - open.length} done.</div>}
    </section>
  );
}

function MissingRow({ f, profile, onAnswer }: { f: FollowUp; profile: Profile; onAnswer: (edits: ProfileEdit[]) => void }) {
  const [value, setValue] = useState<string | number>(f.about === "filer.filingStatus" ? profile.filer.filingStatus : f.about === "filer.state" ? profile.filer.state : 0);
  const path = (f.about ?? "").split(".");
  const control =
    f.about === "filer.filingStatus" ? <Segmented options={[...FILING_OPTIONS]} value={value as FilingStatus} onChange={setValue} />
    : f.about === "filer.state" ? <Select options={STATE_OPTIONS} value={String(value)} onChange={setValue} />
    : <MoneyInput value={Number(value) || 0} onChange={setValue} placeholder="0" />;
  const ready = f.about === "people.self.salary" ? Number(value) > 0 : true;
  return (
    <li className="missing-row">
      <div className="missing-text">{f.text}</div>
      <div className="missing-answer">
        {control}
        <button type="button" className="btn primary" disabled={!ready} onClick={() => onAnswer([{ path, value }, { path: ["sources", f.about ?? ""], value: "answered in app" }])}>Save</button>
      </div>
    </li>
  );
}
