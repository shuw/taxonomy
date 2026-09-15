import { useState } from "react";
import type { Profile, ProfileEdit, Scenario } from "@taxonomy/engine";

interface Props { profile: Profile; scenario: Scenario; edit: (edits: ProfileEdit[]) => void; }

/** Pick, save and drop named lever settings. */
export function ScenarioBar({ profile, scenario, edit }: Props) {
  const names = Object.keys(profile.scenarios ?? { default: {} });
  const active = profile.activeScenario ?? names[0] ?? "default";
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const save = () => {
    const name = draft.trim();
    if (!name) return;
    edit([{ path: ["scenarios", name], value: { events: scenario.events } }, { path: ["activeScenario"], value: name }]);
    setNaming(false);
    setDraft("");
  };
  return (
    <div className="scenario-bar">
      <span className="input-wrap pill">
        <select value={active} onChange={(e) => edit([{ path: ["activeScenario"], value: e.target.value }])} aria-label="Scenario">
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </span>
      {naming
        ? <form className="inline-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <span className="input-wrap"><input autoFocus value={draft} placeholder="scenario name" onChange={(e) => setDraft(e.target.value)} /></span>
            <button type="submit" className="btn primary">Save</button>
            <button type="button" className="btn" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        : <>
            <button type="button" className="btn" onClick={() => setNaming(true)} title="Save the current decisions under a new name">Save as…</button>
            {names.length > 1 && <button type="button" className="btn icon" title="Delete this scenario" onClick={() => { const rest = names.filter((n) => n !== active); edit([{ path: ["scenarios", active], value: undefined }, { path: ["activeScenario"], value: rest[0] }]); }}>🗑</button>}
          </>}
    </div>
  );
}
