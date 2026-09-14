import { useState, type ReactNode } from "react";

interface Props { id: string; title: string; color: string; summary: ReactNode; defaultOpen?: boolean; children: ReactNode; }

/** A collapsible sidebar section that shrinks to a one-line summary. Open state sticks per browser. */
export function Section({ id, title, color, summary, defaultOpen = false, children }: Props) {
  const key = `taxonomy.section.${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === "1"; } catch { return defaultOpen; }
  });
  const toggle = () => {
    setOpen((o) => { try { localStorage.setItem(key, o ? "0" : "1"); } catch {} return !o; });
  };
  return (
    <section className={"section" + (open ? " open" : "")}>
      <button type="button" className="section-head" onClick={toggle} aria-expanded={open}>
        <span className="dot" style={{ background: color }} />
        <span className="section-title">{title}</span>
        {!open && <span className="section-summary">{summary}</span>}
        <svg className="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
