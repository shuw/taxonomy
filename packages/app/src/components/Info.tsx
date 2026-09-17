import { useState, type ReactNode } from "react";

/** A small ⓘ next to a title; hover, focus or tap for the explanation. Keeps the card face clean. */
export function Info({ children, label = "About this" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [right, setRight] = useState(false);
  // Anchored to the right edge when the button sits in the right half of the window, so the popover stays on screen.
  const place = (el: HTMLElement | null) => { if (el) setRight(el.getBoundingClientRect().left > window.innerWidth / 2); };
  return (
    <span className={"info" + (open ? " open" : "") + (right ? " right" : "")} ref={place}>
      <button type="button" className="info-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}>i</button>
      <span className="info-pop" role="tooltip">{children}</span>
    </span>
  );
}
