import type { ReactNode } from "react";
import { Select } from "../fields.tsx";

/** A date input that stores nothing when it equals the default for the year. */
export function DateField({ value, fallback, onChange }: { value?: string; fallback: string; onChange: (d: string | undefined) => void }) {
  return <span className="input-wrap ei-date"><input type="date" value={value ?? fallback} onChange={(e) => onChange(e.target.value && e.target.value !== fallback ? e.target.value : undefined)} /></span>;
}

export function YearSelect({ years, value, onChange }: { years: number[]; value: number; onChange: (y: number) => void }) {
  return <span className="ei-year"><Select options={years.map((y) => ({ value: String(y), label: String(y) }))} value={String(value)} onChange={(y) => onChange(Number(y))} /></span>;
}

interface Props { kind?: string; title: ReactNode; head?: ReactNode; onRemove?: () => void; children?: ReactNode; }

/** The panel under the strip for the selected item: a title line with controls and a Remove link, then the body. */
export function InspectorShell({ kind, title, head, onRemove, children }: Props) {
  return (
    <div className={"event-inspector" + (kind ? ` ${kind}` : "")}>
      <div className="ei-head">
        <strong>{title}</strong>
        {head}
        <span className="spacer" />
        {onRemove && <button type="button" className="link danger" onClick={onRemove}>Remove</button>}
      </div>
      {children}
    </div>
  );
}
