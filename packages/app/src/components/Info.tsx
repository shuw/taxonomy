import { useState, type ReactNode } from "react";

/** The explanation behind a title or label: a small info icon; hover, focus or tap for the text. Keeps the face of a card clean. */
export function Info({ children, label = "About this" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [right, setRight] = useState(false);
  // Anchored to the right edge when the button sits in the right half of the window, so the popover stays on screen.
  const place = (el: HTMLElement | null) => { if (el) setRight(el.getBoundingClientRect().left > window.innerWidth / 2); };
  return (
    <span className={"info" + (open ? " open" : "") + (right ? " right" : "")} ref={place}>
      <button type="button" className="info-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="4.9" r="1" fill="currentColor" />
          <path d="M6.6 7.2h1.9v4.3h1v1H6.8v-1h.9V8.2h-1.1z" fill="currentColor" />
        </svg>
      </button>
      <span className="info-pop" role="tooltip">{children}</span>
    </span>
  );
}
