import { useEffect, useRef, useState } from "react";
import { nextShareSpread, rsuVesting, sharesExercisable, timelineFields, type AmtCrossover, type Levers, type Profile, type ScenarioEvent } from "@taxonomy/engine";
import { shares, usd, usdCompact } from "../format.ts";
import { useWidth } from "../useWidth.ts";
import { LeverRow } from "./LeverRow.tsx";
import { Select } from "./fields.tsx";

/** Same margins as the tax chart, so event columns sit under their bars. */
const M = { left: 46, right: 12 };
export const columnBand = (width: number, n: number) => Math.min(120, (width - M.left - M.right) / n);

/** A marker for something that happens in a year but is not a decision: a fact change or an RSU settlement. */
export interface FactMarker { id: string; year: number; label: string; detail: string; edit?: () => void; }

interface Props {
  profile: Profile;
  levers: Levers;
  years: number[];
  events: ScenarioEvent[];
  facts: FactMarker[];
  crossovers: AmtCrossover[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (kind: "exercise", type: "iso" | "nso", year: number) => void;
  onChange: (id: string, patch: Partial<ScenarioEvent>) => void;
  onRemove: (id: string) => void;
}

const KINDS: { type: "iso" | "nso"; label: string }[] = [{ type: "iso", label: "Exercise ISOs" }, { type: "nso", label: "Exercise NSOs" }];

export function EventTimeline({ profile, levers, years, events, facts, crossovers, selectedId, onSelect, onAdd, onChange, onRemove }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const band = columnBand(width, years.length);
  const [menuYear, setMenuYear] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const has = (t: "iso" | "nso") => profile.equity.grants.some((g) => g.type === t);
  const kinds = KINDS.filter((k) => has(k.type));
  const selected = events.find((e) => e.id === selectedId) ?? null;
  const selectedFact = facts.find((f) => f.id === selectedId) ?? null;

  useEffect(() => {
    if (menuYear === null) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuYear(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuYear]);

  const add = (year: number, type: "iso" | "nso") => { onAdd("exercise", type, year); setMenuYear(null); };

  return (
    <div className="events">
      <div className="event-strip" ref={ref}>
        {years.map((y) => {
          const here = events.filter((e) => e.year === y);
          const factsHere = facts.filter((f) => f.year === y);
          return (
            <div className="event-col" key={y} style={{ flex: `0 0 ${band}px` }}>
              {here.map((e) => (
                <button type="button" key={e.id} className={"ev-chip " + e.kind + " " + (e.kind === "exercise" ? e.type : "") + (e.id === selectedId ? " on" : "")} onClick={() => onSelect(e.id === selectedId ? null : e.id)}>
                  <span className="ev-kind">{e.kind === "exercise" ? `Exercise ${e.type.toUpperCase()}` : e.kind}</span>
                  <span className="ev-val">{shares(e.shares)} sh</span>
                </button>
              ))}
              {factsHere.map((f) => (
                <button type="button" key={f.id} className={"ev-chip fact" + (f.id === selectedId ? " on" : "")} onClick={() => onSelect(f.id === selectedId ? null : f.id)}>
                  <span className="ev-kind">{f.label}</span>
                  <span className="ev-val">{f.detail}</span>
                </button>
              ))}
              {kinds.length > 0 && (
                <div className="ev-add-wrap" ref={menuYear === y ? menuRef : undefined}>
                  <button type="button" className={"ev-add" + (menuYear === y ? " on" : "")} title={`Add a decision in ${y}`} aria-label={`Add a decision in ${y}`}
                    onClick={() => (kinds.length === 1 ? add(y, kinds[0]!.type) : setMenuYear(menuYear === y ? null : y))}>+</button>
                  {menuYear === y && (
                    <div className="ev-menu">
                      {kinds.map((k) => <button type="button" key={k.type} onClick={() => add(y, k.type)}>{k.label}</button>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected && selected.kind === "exercise" && (
        <ExerciseInspector profile={profile} levers={levers} years={years} event={selected} crossovers={crossovers} onChange={(patch) => onChange(selected.id, patch)} onRemove={() => onRemove(selected.id)} />
      )}
      {selectedFact && (
        <div className="event-inspector fact">
          <div className="ei-head">
            <span className="badge fact">{selectedFact.year}</span>
            <strong>{selectedFact.label}</strong>
            <span className="muted">{selectedFact.detail}</span>
            <span className="spacer" />
            {selectedFact.edit && <button type="button" className="link" onClick={selectedFact.edit}>Edit</button>}
          </div>
          <p className="muted small">A fact, not a decision: it applies to every scenario. Decisions are the colored chips.</p>
        </div>
      )}
      {!selected && !selectedFact && events.length === 0 && (
        <p className="muted small events-empty">{kinds.length ? "Nothing decided yet. Press + under a year to add an exercise; sales and liquidity events come next." : "Add option grants under Edit my information and the exercise decisions appear here."}</p>
      )}
    </div>
  );
}

function ExerciseInspector({ profile, levers, years, event: e, crossovers, onChange, onRemove }: { profile: Profile; levers: Levers; years: number[]; event: Extract<ScenarioEvent, { kind: "exercise" }>; crossovers: AmtCrossover[]; onChange: (patch: Partial<ScenarioEvent>) => void; onRemove: () => void }) {
  const cross = crossovers.find((c) => c.year === e.year);
  const available = e.type === "iso" ? (cross?.available ?? 0) : sharesExercisable(profile, levers, "nso", e.year);
  const value = Math.min(e.shares, available);
  const hasMark = e.type === "iso" && !!cross && cross.available > 0 && cross.sharesBeforeAmt < cross.available;
  return (
    <div className="event-inspector">
      <div className="ei-head">
        <strong>Exercise {e.type.toUpperCase()}s in</strong>
        <span className="ei-year"><Select options={years.map((y) => ({ value: String(y), label: String(y) }))} value={String(e.year)} onChange={(y) => onChange({ year: Number(y) })} /></span>
        <span className="spacer" />
        <button type="button" className="link danger" onClick={onRemove}>Remove</button>
      </div>
      <LeverRow label={e.type.toUpperCase()} hint={e.type === "iso" ? "spread goes to AMT" : "spread is wage income"} available={available} value={value}
        mark={hasMark ? cross!.sharesBeforeAmt : null} over={e.type === "iso" && !!cross && value > cross.sharesBeforeAmt} sharesBeforeAmt={cross?.sharesBeforeAmt ?? 0}
        spread={nextShareSpread(profile, e.type, e.year)} onChange={(n) => onChange({ shares: Math.max(0, Math.round(n)) })} />
      {e.shares > available && <p className="muted small">Only {shares(available)} are exercisable in {e.year}; the rest of this event is ignored.</p>}
    </div>
  );
}

/** Fact markers for the strip: dated changes from the profile's timeline and RSU settlements. */
export function factMarkers(profile: Profile, years: number[], onEditTimeline: () => void, onEditEquity: () => void): FactMarker[] {
  const out: FactMarker[] = [];
  const fields = timelineFields();
  for (const [i, t] of (profile.timeline ?? []).entries()) {
    const f = fields.find((x) => x.path === t.path);
    const v = t.value;
    const detail = typeof v === "number" ? (f?.type === "pct" ? `${(v * 100).toFixed(1)}%` : usdCompact(v)) : String(v);
    out.push({ id: `t${i}`, year: t.year, label: f?.label ?? t.path, detail, edit: onEditTimeline });
  }
  if (profile.equity.grants.some((g) => g.type === "rsu")) {
    for (const y of years) {
      const v = rsuVesting(profile, y);
      if (v.shares > 0) out.push({ id: `rsu${y}`, year: y, label: "RSUs settle", detail: `${shares(v.shares)} · ${usdCompact(v.income)}`, edit: onEditEquity });
    }
  }
  return out;
}

export { usd };
