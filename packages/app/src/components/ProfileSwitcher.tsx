import { useEffect, useRef, useState } from "react";
import type { ProfileSummary } from "../api.ts";

interface Props {
  profiles: ProfileSummary[];
  currentId: string;
  currentName: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

const NEW = "__new__";

export function ProfileSwitcher({ profiles, currentId, currentName, onSwitch, onNew, onDuplicate, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const [draft, setDraft] = useState(currentName);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => { setMode("menu"); setDraft(currentName); setOpen((o) => !o); };

  return (
    <div className="switcher" ref={ref}>
      <span className="input-wrap pill">
        <select value={currentId} onChange={(e) => (e.target.value === NEW ? onNew() : onSwitch(e.target.value))} aria-label="Profile">
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.id === currentId ? currentName : p.name}</option>)}
          <option value={NEW}>+ New profile…</option>
        </select>
      </span>
      <button type="button" className="btn icon" onClick={toggle} aria-label="Profile actions" aria-expanded={open}>⋯</button>
      {open && (
        <div className="menu">
          {mode === "menu" && (
            <>
              <button type="button" onClick={() => setMode("rename")}>Rename</button>
              <button type="button" onClick={() => { setOpen(false); onDuplicate(); }}>Duplicate</button>
              <button type="button" onClick={() => { setOpen(false); onNew(); }}>New profile…</button>
              <button type="button" className="danger" onClick={() => setMode("delete")}>Delete…</button>
            </>
          )}
          {mode === "rename" && (
            <form className="menu-form" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onRename(draft.trim()); setOpen(false); } }}>
              <span className="input-wrap"><input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Profile name" /></span>
              <div className="menu-actions">
                <button type="button" className="btn" onClick={() => setMode("menu")}>Cancel</button>
                <button type="submit" className="btn primary">Rename</button>
              </div>
            </form>
          )}
          {mode === "delete" && (
            <div className="menu-form">
              <p>Delete <strong>{currentName}</strong>? The file is removed from <code>data/profiles</code>.{profiles.length < 2 ? " It is your only profile; you will start over." : ""}</p>
              <div className="menu-actions">
                <button type="button" className="btn" onClick={() => setMode("menu")}>Keep</button>
                <button type="button" className="btn danger" onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
