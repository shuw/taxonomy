import { useState } from "react";
import type { ProfileSummary } from "../api.ts";
import { Picker } from "./Picker.tsx";

interface Props {
  profiles: ProfileSummary[];
  currentId: string;
  currentName: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  /** Shown on a hosted server: opens the account dialog, or signs out at once. */
  onAccount?: () => void;
  onSignOut?: () => void;
}

/** Pick a profile; the same menu renames, duplicates, creates or deletes one. */
export function ProfileSwitcher({ profiles, currentId, currentName, onSwitch, onNew, onDuplicate, onRename, onDelete, onAccount, onSignOut }: Props) {
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const [draft, setDraft] = useState(currentName);
  const taken = profiles.some((p) => p.id !== currentId && p.name.trim().toLowerCase() === draft.trim().toLowerCase());
  const panel = mode === "rename" ? (
    <form className="menu-form" onSubmit={(e) => { e.preventDefault(); if (draft.trim() && !taken) { onRename(draft.trim()); setMode("menu"); } }}>
      <span className="input-wrap"><input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Profile name" /></span>
      {taken && <span className="field-error">Another profile is already called {draft.trim()}.</span>}
      <div className="menu-actions">
        <button type="button" className="btn" onClick={() => setMode("menu")}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!draft.trim() || taken}>Rename</button>
      </div>
    </form>
  ) : mode === "delete" ? (
    <div className="menu-form">
      <p>Delete <strong>{currentName}</strong>? Its file is removed.{profiles.length < 2 ? " It is your only profile; you will start over." : ""}</p>
      <div className="menu-actions">
        <button type="button" className="btn" onClick={() => setMode("menu")}>Keep</button>
        <button type="button" className="btn danger" onClick={() => { setMode("menu"); onDelete(); }}>Delete</button>
      </div>
    </div>
  ) : undefined;
  return (
    <Picker
      label="Profile" value={currentId} accent
      options={profiles.map((p) => ({ value: p.id, label: p.id === currentId ? currentName : p.name }))}
      onChange={onSwitch}
      onClose={() => setMode("menu")}
      panel={panel}
      actions={(close) => (
        <>
          <button type="button" onClick={() => { setDraft(currentName); setMode("rename"); }}>Rename…</button>
          <button type="button" onClick={() => { close(); onDuplicate(); }}>Duplicate</button>
          <button type="button" onClick={() => { close(); onNew(); }}>New profile…</button>
          <button type="button" className="danger" onClick={() => setMode("delete")}>Delete…</button>
          {onAccount && <><div className="menu-sep" /><button type="button" onClick={() => { close(); onAccount(); }}>Account…</button></>}
          {onSignOut && <button type="button" onClick={() => { close(); onSignOut(); }}>Sign out</button>}
        </>
      )}
    />
  );
}
