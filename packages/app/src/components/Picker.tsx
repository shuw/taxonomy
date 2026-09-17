import { useEffect, useRef, useState, type ReactNode } from "react";

export interface PickerOption { value: string; label: string; hint?: string; }

interface Props {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  /** Menu items under the options, in the same menu; get `close` to dismiss. */
  actions?: (close: () => void) => ReactNode;
  /** When set, the menu shows this instead of the options (a rename form, a delete confirmation). */
  panel?: ReactNode;
  accent?: boolean;
  /** Called when the menu is dismissed, so an owner showing a form in `panel` can put the options back. */
  onClose?: () => void;
}

/** A pill that opens the app's own menu instead of the browser's select popup. */
export function Picker({ label, value, options, onChange, actions, panel, accent, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dismiss = () => { setOpen(false); onClose?.(); };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) dismiss(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { dismiss(); return; }
      // Arrow keys walk the menu; Home and End jump; focus leaving the menu closes it (see onBlur).
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(".menu button:not([disabled])")];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]!.focus(); e.preventDefault();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const current = options.find((o) => o.value === value);
  const close = () => dismiss();
  return (
    <div className="picker" ref={ref} onBlur={(e) => { if (open && !ref.current?.contains(e.relatedTarget as Node | null)) dismiss(); }}>
      <button type="button" className={"pill-btn" + (accent ? " accent" : "")} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? dismiss() : setOpen(true))}>
        <span className="pill-text">{current?.label ?? value}</span>
        <svg className="chev" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="menu" role="menu">
          {panel ?? (
            <>
              {options.map((o) => (
                <button type="button" role="menuitemradio" aria-checked={o.value === value} key={o.value} className={"opt" + (o.value === value ? " on" : "")} onClick={() => { onChange(o.value); close(); }}>
                  <span className="opt-check" aria-hidden="true">{o.value === value ? "✓" : ""}</span>
                  <span className="opt-text">{o.label}{o.hint && <span className="opt-hint">{o.hint}</span>}</span>
                </button>
              ))}
              {actions && <div className="menu-sep" />}
              {actions?.(close)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
