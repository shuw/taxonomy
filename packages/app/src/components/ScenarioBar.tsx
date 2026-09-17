import { useState } from "react";
import type { Profile, ProfileEdit, Scenario } from "@taxonomy/engine";
import { Picker } from "./Picker.tsx";

interface Props { profile: Profile; scenario: Scenario; edit: (edits: ProfileEdit[]) => void; }

/** Pick a scenario; the same menu saves the current decisions under a new name or deletes one. */
export function ScenarioBar({ profile, scenario, edit }: Props) {
  const scenarios = profile.scenarios ?? { default: { events: [] } };
  const names = Object.keys(scenarios);
  const active = profile.activeScenario ?? names[0] ?? "default";
  const [mode, setMode] = useState<"menu" | "save" | "delete">("menu");
  const [draft, setDraft] = useState("");
  const save = (close: () => void) => {
    const name = draft.trim();
    if (!name) return;
    edit([{ path: ["scenarios", name], value: { events: scenario.events } }, { path: ["activeScenario"], value: name }]);
    setDraft(""); setMode("menu"); close();
  };
  const remove = (close: () => void) => {
    const rest = names.filter((n) => n !== active);
    edit([{ path: ["scenarios", active], value: undefined }, { path: ["activeScenario"], value: rest[0] }]);
    setMode("menu"); close();
  };
  const panel = (close: () => void) => mode === "save" ? (
    <form className="menu-form" onSubmit={(e) => { e.preventDefault(); save(close); }}>
      <p>Save the current decisions as a new scenario.</p>
      <span className="input-wrap"><input autoFocus value={draft} placeholder="scenario name" onChange={(e) => setDraft(e.target.value)} /></span>
      <div className="menu-actions">
        <button type="button" className="btn" onClick={() => setMode("menu")}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!draft.trim()}>Save</button>
      </div>
    </form>
  ) : mode === "delete" ? (
    <div className="menu-form">
      <p>Delete scenario <strong>{active}</strong>? Its decisions are gone; the others stay.</p>
      <div className="menu-actions">
        <button type="button" className="btn" onClick={() => setMode("menu")}>Keep</button>
        <button type="button" className="btn danger" onClick={() => remove(close)}>Delete</button>
      </div>
    </div>
  ) : undefined;
  return (
    <div className="scenario-bar">
      <Picker
        label="Scenario" value={active} accent
        options={names.map((n) => ({ value: n, label: n, hint: scenarios[n]?.note }))}
        onChange={(n) => edit([{ path: ["activeScenario"], value: n }])}
        onClose={() => setMode("menu")}
        panel={panel(() => setMode("menu"))}
        actions={(close) => (
          <>
            <button type="button" onClick={() => setMode("save")}>Save as…</button>
            <button type="button" className="danger" disabled={names.length < 2} onClick={() => setMode("delete")}>Delete…</button>
          </>
        )}
      />
    </div>
  );
}
