import { kindStyle } from "../../series.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { companyName, companyPrice, type AmtCrossover, type Levers, type PlanResult, type Profile, type SaleResult, type ScenarioEvent, type TimelineEntry } from "@taxonomy/engine";
import { shares, usd, usdCompact } from "../../format.ts";
import { useWidth } from "../../useWidth.ts";
import { MAX_BAND } from "../Strips.tsx";
import { AddMenu, decisionKinds } from "./AddMenu.tsx";
import { ExerciseInspector } from "./ExerciseInspector.tsx";
import { FactChangeInspector } from "./FactChangeInspector.tsx";
import { InspectorShell } from "./InspectorShell.tsx";
import { LiquidityInspector } from "./LiquidityInspector.tsx";
import { SaleInspector } from "./SaleInspector.tsx";
import { GiveInspector, giveHow } from "./GiveInspector.tsx";
import { STRIP_MARGIN as M, type AddKind, type FactMarker } from "./types.ts";
import { useChipDrag } from "./useChipDrag.ts";

export const columnBand = (width: number, n: number) => Math.min(MAX_BAND, (width - M.left - M.right) / n);

interface Props {
  profile: Profile;
  levers: Levers;
  plan: PlanResult;
  years: number[];
  events: ScenarioEvent[];
  facts: FactMarker[];
  crossovers: AmtCrossover[];
  selectedId: string | null;
  focusYear: number;
  onSelect: (id: string | null) => void;
  onAdd: (what: AddKind, year: number) => void;
  onChange: (id: string, patch: Partial<ScenarioEvent>) => void;
  onRemove: (id: string) => void;
  onSellToCover: (id: string) => void;
  onAddFact: (path: string, year: number) => void;
  onChangeFact: (index: number, entry: TimelineEntry) => void;
  onRemoveFact: (index: number) => void;
}

/** The strip under the chart: one column per plan year with decision chips, fact lines and a +; one inspector for the selection. */
export function EventTimeline({ profile, levers, plan, years, events, facts, crossovers, selectedId, focusYear, onSelect, onAdd, onChange, onRemove, onSellToCover, onAddFact, onChangeFact, onRemoveFact }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const band = columnBand(width, years.length);
  const [menuYear, setMenuYear] = useState<number | null>(null);
  const columnAt = (clientX: number): number | null => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    const i = Math.floor((clientX - rect.left - M.left) / band);
    return i >= 0 && i < years.length ? years[i]! : null;
  };
  const drag = useChipDrag(columnAt, (id, year) => onChange(id, { year, date: undefined }), (id) => onSelect(id === selectedId ? null : id));
  const selected = events.find((e) => e.id === selectedId) ?? null;
  const selectedFact = facts.find((f) => f.id === selectedId) ?? null;
  const saleResult = (e: Extract<ScenarioEvent, { kind: "sell" }>): SaleResult | undefined => {
    const yr = plan.years.find((y) => y.year === e.year);
    const order = (levers.sales?.[e.year] ?? []).map((s) => s.id);
    return yr?.sales?.[order.indexOf(e.id)];
  };
  const chipKind = (e: ScenarioEvent) => e.kind === "exercise" ? `Exercise ${e.type.toUpperCase()} · ${companyName(profile, e.company)}` : e.kind === "sell" ? `Sell · ${usdCompact(saleResult(e)?.proceeds ?? 0)}` : e.kind === "give" ? `Give · ${giveHow(e.how)}` : "Liquidity";
  const chipValue = (e: ScenarioEvent) => {
    if (e.kind === "exercise") return `${shares(e.shares)} sh`;
    if (e.kind === "sell") return `${shares(saleResult(e)?.shares ?? e.shares)} sh`;
    if (e.kind === "give") return usdCompact(e.amount);
    const c = profile.equity.companies.find((x) => x.id === e.company) ?? profile.equity.companies[0];
    return `${usd(e.price ?? companyPrice(profile, c, e.year))}/sh`;
  };
  // The inspector floats right under the selected chip, as wide as it needs, kept inside the strip.
  const eventsRef = useRef<HTMLDivElement>(null);
  const panelWidth = Math.min(selected?.kind === "sell" ? 760 : 640, Math.max(320, width));
  const [anchor, setAnchor] = useState<{ top: number; left: number; caret: number } | null>(null);
  useLayoutEffect(() => {
    const root = eventsRef.current;
    const el = root && selectedId ? (root.querySelector(`[data-id="${CSS.escape(selectedId)}"]`) as HTMLElement | null) : null;
    if (!root || !el) { setAnchor(null); return; }
    const r = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    const left = Math.max(0, Math.min(r.left - b.left, Math.max(0, b.width - panelWidth)));
    setAnchor({ top: r.bottom - b.top + 10, left, caret: Math.max(14, Math.min(panelWidth - 14, r.left - b.left - left + Math.min(r.width / 2, 60))) });
  }, [selectedId, width, panelWidth, events, facts]);
  // A click anywhere else puts the inspector away; chips, the add menu and dialogs keep it.
  useEffect(() => {
    if (!selectedId) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(".inspector-slot, .ev-chip, .ev-info, .ev-add-wrap, .ev-menu, .modal-backdrop")) return;
      onSelect(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [selectedId, onSelect]);
  const anchorStyle = anchor ? ({ top: anchor.top, left: anchor.left, width: panelWidth, "--caret": `${anchor.caret}px` } as React.CSSProperties) : undefined;
  const canAdd = decisionKinds(profile).length > 0;

  return (
    <div className="events" ref={eventsRef}>
      <div className="event-strip" ref={ref}>
        {years.map((y) => (
          <div className={"event-col" + (y === focusYear ? " focus" : "") + (drag.drag?.moved && drag.drag.target === y ? " target" : "")} key={y} style={{ flex: `0 0 ${band}px` }}>
            <AddMenu year={y} profile={profile} open={menuYear === y} onOpen={(o) => setMenuYear(o ? y : null)} onAdd={(what) => { onAdd(what, y); setMenuYear(null); }} onAddFact={(path) => { onAddFact(path, y); setMenuYear(null); }} />
            {events.filter((e) => e.year === y).map((e) => (
              <button type="button" key={e.id} data-id={e.id} className={"ev-chip " + e.kind + (e.id === selectedId ? " on" : "") + (drag.drag?.id === e.id && drag.drag.moved ? " dragging" : "")} style={kindStyle(e.kind === "exercise" ? e.type : e.kind)}
                onPointerDown={drag.start(e.id)} onPointerMove={drag.move} onPointerUp={drag.end(e)} onPointerCancel={drag.cancel} title="Drag to another year">
                <span className="ev-kind">{chipKind(e)}</span>
                <span className="ev-val">{chipValue(e)}</span>
              </button>
            ))}
            {facts.filter((f) => f.year === y).map((f) => (
              <button type="button" key={f.id} data-id={f.id} className={"ev-info" + (f.id === selectedId ? " on" : "")} onClick={() => onSelect(f.id === selectedId ? null : f.id)} title={`${f.label} · ${f.detail}`}>
                <span className="ev-dot" /><span className="ev-info-text"><span className="ev-info-label">{f.label}</span> <span className="ev-info-detail">{f.detail}</span></span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {drag.drag?.moved && (() => { const e = events.find((x) => x.id === drag.drag!.id); return e ? <div className="ev-ghost" style={{ left: drag.drag.x + 10, top: drag.drag.y - 10 }}>{chipKind(e)} → {drag.drag.target ?? "…"}</div> : null; })()}
      {anchor && <div className="inspector-slot floating" style={anchorStyle}>
        {selected?.kind === "exercise" && <ExerciseInspector profile={profile} levers={levers} years={years} event={selected} crossovers={crossovers} companyLabel={companyName(profile, selected.company)} onChange={(p) => onChange(selected.id, p)} onRemove={() => onRemove(selected.id)} />}
        {selected?.kind === "liquidity" && <LiquidityInspector profile={profile} plan={plan} years={years} event={selected} onChange={(p) => onChange(selected.id, p)} onRemove={() => onRemove(selected.id)} />}
        {selected?.kind === "sell" && <SaleInspector profile={profile} plan={plan} years={years} event={selected} result={saleResult(selected)} onChange={(p) => onChange(selected.id, p)} onRemove={() => onRemove(selected.id)} onSellToCover={() => onSellToCover(selected.id)} />}
        {selected?.kind === "give" && <GiveInspector years={years} event={selected} onChange={(p) => onChange(selected.id, p)} onRemove={() => onRemove(selected.id)} />}
        {selectedFact && selectedFact.entryIndex !== undefined && profile.timeline?.[selectedFact.entryIndex] && (
          <FactChangeInspector profile={profile} years={years} entry={profile.timeline[selectedFact.entryIndex]!} onChange={(e) => onChangeFact(selectedFact.entryIndex!, e)} onRemove={() => onRemoveFact(selectedFact.entryIndex!)} />
        )}
        {selectedFact && selectedFact.entryIndex === undefined && (
          <InspectorShell kind="fact" title={selectedFact.label} head={<><span className="badge fact">{selectedFact.year}</span><span className="muted">{selectedFact.detail}</span>{selectedFact.edit && <button type="button" className="link" onClick={selectedFact.edit}>Edit</button>}</>}>
            <p className="muted small">A fact, not a decision: it applies to every scenario. Decisions are the chips above.</p>
          </InspectorShell>
        )}
      </div>}
      {!selected && !selectedFact && events.length === 0 && (
        <p className="muted small events-empty">{canAdd ? "Nothing decided yet. Press + under a year to add an exercise, a sale, or a change like a raise." : "Press + under a year to add a change like a raise. Add option grants or shares you own under Edit my information for exercise and sale decisions."}</p>
      )}
    </div>
  );
}
