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
}

/** A pill that opens the app's own menu instead of the browser's select popup. */
export function Picker({ label, value, options, onChange, actions, panel, accent }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const current = options.find((o) => o.value === value);
  const close = () => setOpen(false);
  return (
    <div className="picker" ref={ref}>
      <button type="button" className={"pill-btn" + (accent ? " accent" : "")} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
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
