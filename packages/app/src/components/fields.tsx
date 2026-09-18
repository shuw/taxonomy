import { parseBirthYears } from "@taxonomy/engine";
import { demo } from "../format.ts";
import { Info } from "./Info.tsx";
import { useDocumentLink } from "./Documents.tsx";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The "source" chip on a field; a link when the source names a stored document. */
/** The "source" chip: click it to read where the value came from; when the source names a stored document, a link opens the page. */
export function SourceChip({ source }: { source?: string }) {
  const href = useDocumentLink(source);
  const [open, setOpen] = useState(false);
  const [right, setRight] = useState(false);
  const box = useRef<HTMLElement | null>(null);
  const place = (el: HTMLElement | null) => { box.current = el; if (el) setRight(el.getBoundingClientRect().left > window.innerWidth / 2); };
  // A press anywhere else puts it away.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!source) return null;
  return (
    <span className={"info src-info" + (open ? " open" : "") + (right ? " right" : "")} ref={place} onMouseDown={(e) => e.preventDefault()}>
      <button type="button" className={"src" + (href ? " linked" : "")} aria-expanded={open} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>source{href ? " ↗" : ""}</button>
      <span className="info-pop" role="tooltip">
        <span className="src-from">Where this came from</span>
        {source}
        {href && <><br /><a href={href} target="_blank" rel="noreferrer" onMouseDown={(e) => e.stopPropagation()}>Open the document ↗</a></>}
      </span>
    </span>
  );
}

export function Field({ label, hint, children, wide, source, note, error }: { label: string; hint?: string; children: ReactNode; wide?: boolean; source?: string; note?: string; error?: string }) {
  return (
    <label className={"field" + (wide ? " wide" : "") + (error ? " invalid" : "")}>
      <span className="field-label">{label}{hint && <span className="field-hint"> {hint}</span>}<SourceChip source={source} />{note && <Info label="About this field">{note}</Info>}</span>
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
  const input = useRef<HTMLInputElement>(null);
  // Where the caret should land after the text is regrouped, counted in digits from the left.
  const caretDigits = useRef<number | null>(null);
  useEffect(() => { if (!focused.current) setText(fmt(value)); }, [value]);
  useLayoutEffect(() => {
    if (caretDigits.current === null || !input.current) return;
    let seen = 0, pos = text.length;
    for (let i = 0; i < text.length; i++) { if (/\d/.test(text[i]!)) seen++; if (seen === caretDigits.current) { pos = i + 1; break; } }
    if (caretDigits.current === 0) pos = 0;
    input.current.setSelectionRange(pos, pos);
    caretDigits.current = null;
  }, [text]);
  return (
    <span className="input-wrap">
      {prefix && <span className="affix">{prefix}</span>}
      <input
        ref={input} type="text" inputMode="decimal" value={text} placeholder={placeholder}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(fmt(value)); }}
        onChange={(e) => {
          const raw = e.target.value;
          // Plain whole numbers are regrouped as they are typed ("5,000,0000" reads as 50,000,000); anything with a suffix or a decimal point is left alone until blur.
          const plain = grouping && /^-?[\d,]*$/.test(raw) && raw.replace(/[^\d]/g, "").length > 0;
          if (plain) {
            const digitsBeforeCaret = raw.slice(0, e.target.selectionStart ?? raw.length).replace(/[^\d]/g, "").length;
            const grouped = (raw.startsWith("-") ? "-" : "") + Number(raw.replace(/[^\d]/g, "")).toLocaleString("en-US");
            caretDigits.current = digitsBeforeCaret;
            setText(grouped);
          } else setText(raw);
          const n = parseAmount(raw);
          if (raw.trim() === "") onChange(0);
          else if (n !== null) onChange(min !== undefined ? Math.max(min, n) : n);
        }}
      />
      {suffix && <span className="affix">{suffix}</span>}
    </span>
  );
}

/** Dependents as birth years, typed freely: the text is yours while the field has focus, and the profile follows what parses. */
export function DependentsInput({ dependents, onChange }: { dependents: { name?: string; birthYear?: number }[]; onChange: (list: { birthYear?: number }[]) => void }) {
  const shown = dependents.map((d) => d.birthYear ?? d.name ?? "?").join(", ");
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(shown); }, [shown]);
  return (
    <span className="input-wrap">
      <input value={text} placeholder="e.g. 2019, 2022" inputMode="numeric"
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(shown); }}
        onChange={(e) => { setText(e.target.value); onChange(parseBirthYears(e.target.value)); }} />
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
  ? <span className="input-wrap demo"><span className="affix">{demo.symbol}</span><input value={Math.round(p.value * demo.scale).toLocaleString("en-US")} readOnly title="Demo mode: amounts cannot be edited" /></span>
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
