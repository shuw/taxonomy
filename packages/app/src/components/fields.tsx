import { demo } from "../format.ts";
import { Info } from "./Info.tsx";
import { useDocumentLink } from "./Documents.tsx";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** The "source" chip on a field; a link when the source names a stored document. */
export function SourceChip({ source }: { source?: string }) {
  const href = useDocumentLink(source);
  if (!source) return null;
  return href
    ? <a className="src linked" href={href} target="_blank" rel="noreferrer" title={source} onClick={(e) => e.stopPropagation()}>source ↗</a>
    : <span className="src" title={source}>source</span>;
}

export function Field({ label, hint, children, wide, source, note, error }: { label: string; hint?: string; children: ReactNode; wide?: boolean; source?: string; note?: string; error?: string }) {
  return (
    <label className={"field" + (wide ? " wide" : "") + (error ? " invalid" : "")}>
      <span className="field-label">{label}{hint && <span className="field-hint"> {hint}</span>}<SourceChip source={source} />{note && <Info label="Note from Claude">{note}</Info>}</span>
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

interface NumProps { value: number; onChange: (n: number) => void; prefix?: string; suffix?: string; decimals?: number; min?: number; step?: number; placeholder?: string; grouping?: boolean; }

/** Number input that shows a formatted value when idle and raw text while typing. */
export function NumberInput({ value, onChange, prefix, suffix, decimals = 0, min, placeholder, grouping = true }: NumProps) {
  const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { useGrouping: grouping, maximumFractionDigits: decimals, minimumFractionDigits: decimals > 0 && !Number.isInteger(n) ? Math.min(decimals, 2) : 0 }) : "");
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(fmt(value)); }, [value]);
  return (
    <span className="input-wrap">
      {prefix && <span className="affix">{prefix}</span>}
      <input
        type="text" inputMode="decimal" value={text} placeholder={placeholder}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(fmt(value)); }}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const n = parseAmount(raw);
          if (raw.trim() === "") onChange(0);
          else if (n !== null) onChange(min !== undefined ? Math.max(min, n) : n);
        }}
      />
      {suffix && <span className="affix">{suffix}</span>}
    </span>
  );
}

/** "620k" -> 620000, "1.2m" -> 1200000, "$45,000" -> 45000. Null when not a number. */
export function parseAmount(raw: string): number | null {
  const m = raw.trim().match(/^\$?\s*(-?[\d,]*\.?\d*)\s*([kKmM])?$/);
  if (!m || !m[1] || m[1] === "-" || m[1] === ".") return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  return n * mult;
}

export const MoneyInput = (p: Omit<NumProps, "prefix">) => demo.on
  ? <span className="input-wrap demo"><span className="affix">{demo.symbol}</span><input value={Math.round(p.value * demo.scale).toLocaleString("en-US")} readOnly title="Demo mode: amounts are shown in a made-up currency and cannot be edited" /></span>
  : <NumberInput prefix="$" min={0} {...p} />;

/** Percent input over a fraction value: 0.15 shows as 15. */
export function PercentInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return <NumberInput value={value * 100} onChange={(n) => onChange(n / 100)} suffix="%" decimals={1} />;
}

export function Segmented<T extends string>({ options, value, onChange, columns }: { options: { value: T; label: string; key?: string }[]; value: T; onChange: (v: T) => void; columns?: number }) {
  return (
    <div className="segmented" role="radiogroup" style={columns ? { display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}{o.key && <kbd>{o.key}</kbd>}</button>
      ))}
    </div>
  );
}

export function Select<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <span className="input-wrap">
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

export const FILING_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "mfj", label: "Married, joint" },
  { value: "mfs", label: "Married, separate" },
  { value: "hoh", label: "Head of household" },
] as const;

import { MODELED_STATES } from "@taxonomy/engine";
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const modeled = new Map(MODELED_STATES.map((m) => [m.code, m]));
export const STATE_OPTIONS = [
  ...MODELED_STATES.map((m) => ({ value: m.code, label: `${m.code} · ${m.name} (${m.note})` })),
  ...STATES.filter((s) => !modeled.has(s)).map((s) => ({ value: s, label: `${s} (state tax not modeled yet)` })),
];
