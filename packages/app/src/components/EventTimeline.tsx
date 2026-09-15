import { useEffect, useRef, useState } from "react";
import { companyPrice, getPath, lotMilestones, lotPrice, isLongTerm, isQualifying, longTermFrom, openingLots, qualifyingFrom, nextShareSpread, rsuVesting, sharesExercisable, timelineFields, type AmtCrossover, type Levers, type Lot, type PlanResult, type Profile, type SaleResult, type ScenarioEvent } from "@taxonomy/engine";
import { fmtDelta, shares, usd, usdCompact } from "../format.ts";
import { useWidth } from "../useWidth.ts";
import { LeverRow } from "./LeverRow.tsx";
import { MoneyInput, NumberInput, Select } from "./fields.tsx";

/** Same margins as the tax chart, so event columns sit under their bars. */
const M = { left: 46, right: 12 };
export const columnBand = (width: number, n: number) => Math.min(120, (width - M.left - M.right) / n);

/** A marker for something that happens in a year but is not a decision: a fact change or an RSU settlement. */
export interface FactMarker { id: string; year: number; label: string; detail: string; edit?: () => void; milestone?: boolean; }

export type AddKind = { kind: "exercise"; type: "iso" | "nso" } | { kind: "sell" } | { kind: "liquidity" };

interface Props {
  profile: Profile;
  levers: Levers;
  plan: PlanResult;
  years: number[];
  events: ScenarioEvent[];
  facts: FactMarker[];
  crossovers: AmtCrossover[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (what: AddKind, year: number) => void;
  onChange: (id: string, patch: Partial<ScenarioEvent>) => void;
  onRemove: (id: string) => void;
  onSellToCover: (id: string) => void;
}

export function EventTimeline({ profile, levers, plan, years, events, facts, crossovers, selectedId, onSelect, onAdd, onChange, onRemove, onSellToCover }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const band = columnBand(width, years.length);
  const [menuYear, setMenuYear] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const has = (t: "iso" | "nso") => profile.equity.grants.some((g) => g.type === t);
  const canSell = profile.equity.grants.length > 0 || (profile.equity.holdings?.length ?? 0) > 0;
  const kinds: { key: string; label: string; what: AddKind }[] = [
    ...(has("iso") ? [{ key: "iso", label: "Exercise ISOs", what: { kind: "exercise", type: "iso" } as AddKind }] : []),
    ...(has("nso") ? [{ key: "nso", label: "Exercise NSOs", what: { kind: "exercise", type: "nso" } as AddKind }] : []),
    ...(canSell ? [{ key: "sell", label: "Sell shares", what: { kind: "sell" } as AddKind }] : []),
    ...(profile.equity.companies.length > 0 ? [{ key: "liquidity", label: "Liquidity event (IPO, tender)", what: { kind: "liquidity" } as AddKind }] : []),
  ];
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; target: number | null; moved: boolean } | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const columnAt = (clientX: number): number | null => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const i = Math.floor((clientX - rect.left - M.left) / band);
    return i >= 0 && i < years.length ? years[i]! : null;
  };
  const startDrag = (id: string) => (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ id, x: ev.clientX, y: ev.clientY, target: null, moved: false });
  };
  const moveDrag = (ev: React.PointerEvent) => {
    if (!drag || drag.id !== (ev.currentTarget as HTMLElement).dataset.id) return;
    const moved = drag.moved || Math.abs(ev.clientX - drag.x) > 6 || Math.abs(ev.clientY - drag.y) > 6;
    setDrag({ ...drag, x: moved ? ev.clientX : drag.x, y: moved ? ev.clientY : drag.y, target: moved ? columnAt(ev.clientX) : null, moved });
  };
  const endDrag = (e: ScenarioEvent) => (ev: React.PointerEvent) => {
    if (!drag || drag.id !== e.id) return;
    const target = drag.moved ? columnAt(ev.clientX) : null;
    setDrag(null);
    if (drag.moved) { if (target !== null && target !== e.year) onChange(e.id, { year: target, date: undefined }); }
    else onSelect(e.id === selectedId ? null : e.id);
  };
  const selected = events.find((e) => e.id === selectedId) ?? null;
  const selectedFact = facts.find((f) => f.id === selectedId) ?? null;

  useEffect(() => {
    if (menuYear === null) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuYear(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuYear]);

  const add = (year: number, what: AddKind) => { onAdd(what, year); setMenuYear(null); };
  const saleResult = (e: Extract<ScenarioEvent, { kind: "sell" }>): SaleResult | undefined => {
    const yr = plan.years.find((y) => y.year === e.year);
    const order = (levers.sales?.[e.year] ?? []).map((s) => s.id);
    return yr?.sales?.[order.indexOf(e.id)];
  };

  return (
    <div className="events">
      <div className="event-strip" ref={(el) => { (ref as React.MutableRefObject<HTMLDivElement | null>).current = el; stripRef.current = el; }}>
        <span className="strip-label">You decide</span>
        {years.map((y) => {
          const here = events.filter((e) => e.year === y);
          return (
            <div className={"event-col" + (drag?.moved && drag.target === y ? " target" : "")} key={y} style={{ flex: `0 0 ${band}px` }}>
              {here.map((e) => (
                <button type="button" key={e.id} data-id={e.id} className={"ev-chip " + e.kind + " " + (e.kind === "exercise" ? e.type : "") + (e.id === selectedId ? " on" : "") + (drag?.id === e.id && drag.moved ? " dragging" : "")}
                  onPointerDown={startDrag(e.id)} onPointerMove={moveDrag} onPointerUp={endDrag(e)} onPointerCancel={() => setDrag(null)} title="Drag to another year">
                  <span className="ev-kind">{chipKind(e, saleResult)}</span>
                  <span className="ev-val">{chipValue(e, profile, saleResult)}</span>
                </button>
              ))}
              {kinds.length > 0 && (
                <div className="ev-add-wrap" ref={menuYear === y ? menuRef : undefined}>
                  <button type="button" className={"ev-add" + (menuYear === y ? " on" : "")} title={`Add a decision in ${y}`} aria-label={`Add a decision in ${y}`}
                    onClick={() => (kinds.length === 1 ? add(y, kinds[0]!.what) : setMenuYear(menuYear === y ? null : y))}>+</button>
                  {menuYear === y && (
                    <div className="ev-menu">
                      {kinds.map((k) => <button type="button" key={k.key} onClick={() => add(y, k.what)}>{k.label}</button>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {facts.length > 0 && (
        <div className="event-strip info">
          <span className="strip-label">Happens anyway</span>
          {years.map((y) => (
            <div className="event-col" key={y} style={{ flex: `0 0 ${band}px` }}>
              {facts.filter((f) => f.year === y).map((f) => (
                <button type="button" key={f.id} className={"ev-info" + (f.milestone ? " milestone" : "") + (f.id === selectedId ? " on" : "")} onClick={() => onSelect(f.id === selectedId ? null : f.id)} title={`${f.label} · ${f.detail}`}>
                  <span className="ev-dot" /><span className="ev-info-text"><span className="ev-info-label">{f.label}</span> <span className="ev-info-detail">{f.detail}</span></span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {drag?.moved && (() => { const e = events.find((x) => x.id === drag.id); return e ? <div className="ev-ghost" style={{ left: drag.x + 10, top: drag.y - 10 }}>{chipKind(e, saleResult)} → {drag.target ?? "…"}</div> : null; })()}
      {selected && selected.kind === "liquidity" && (
        <LiquidityInspector profile={profile} plan={plan} years={years} event={selected} onChange={(patch) => onChange(selected.id, patch)} onRemove={() => onRemove(selected.id)} />
      )}
      {selected && selected.kind === "sell" && (
        <SaleInspector profile={profile} plan={plan} years={years} event={selected} result={saleResult(selected)} onChange={(patch) => onChange(selected.id, patch)} onRemove={() => onRemove(selected.id)} onSellToCover={() => onSellToCover(selected.id)} />
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
          <p className="muted small">{selectedFact.milestone ? "A holding-period milestone: shares held cross into a cheaper tax treatment on this date. Sell on or after it to get that treatment." : "A fact, not a decision: it applies to every scenario. Decisions are the colored chips."}</p>
        </div>
      )}
      {!selected && !selectedFact && events.length === 0 && (
        <p className="muted small events-empty">{kinds.length ? "Nothing decided yet. Press + under a year to add an exercise or a sale." : "Add option grants or shares you own under Edit my information, and the decisions appear here."}</p>
      )}
    </div>
  );
}

function chipKind(e: ScenarioEvent, saleResult: (e: Extract<ScenarioEvent, { kind: "sell" }>) => SaleResult | undefined): string {
  if (e.kind === "exercise") return `Exercise ${e.type.toUpperCase()}`;
  if (e.kind === "sell") return `Sell · ${usdCompact(saleResult(e)?.proceeds ?? 0)}`;
  return "Liquidity";
}
function chipValue(e: ScenarioEvent, profile: Profile, saleResult: (e: Extract<ScenarioEvent, { kind: "sell" }>) => SaleResult | undefined): string {
  if (e.kind === "exercise") return `${shares(e.shares)} sh`;
  if (e.kind === "sell") return `${shares(saleResult(e)?.shares ?? e.shares)} sh`;
  const c = profile.equity.companies.find((x) => x.id === e.company) ?? profile.equity.companies[0];
  return `${usd(e.price ?? companyPrice(profile, c, e.year))}/sh`;
}

function LiquidityInspector({ profile, plan, years, event: e, onChange, onRemove }: { profile: Profile; plan: PlanResult; years: number[]; event: Extract<ScenarioEvent, { kind: "liquidity" }>; onChange: (patch: Partial<ScenarioEvent>) => void; onRemove: () => void }) {
  const companies = profile.equity.companies;
  const c = companies.find((x) => x.id === e.company) ?? companies[0];
  const modeled = companyPrice(profile, c, e.year);
  const yr = plan.years.find((y) => y.year === e.year);
  const doubleTrigger = profile.equity.grants.some((g) => g.type === "rsu" && g.settlement === "liquidity" && (g.company ?? companies[0]?.id) === c?.id);
  return (
    <div className="event-inspector liquidity">
      <div className="ei-head">
        <strong>Liquidity event</strong>
        <span className="muted">in</span>
        <span className="ei-year"><Select options={years.map((y) => ({ value: String(y), label: String(y) }))} value={String(e.year)} onChange={(y) => onChange({ year: Number(y) })} /></span>
        {companies.length > 1 && <span className="ei-year"><Select options={companies.map((x) => ({ value: x.id, label: x.name }))} value={c?.id ?? ""} onChange={(id) => onChange({ company: id })} /></span>}
        <span className="spacer" />
        <button type="button" className="link danger" onClick={onRemove}>Remove</button>
      </div>
      <div className="ei-row">
        <label className="ei-price">
          <span className="muted small">Share price at the event</span>
          <MoneyInput value={e.price ?? modeled} onChange={(n) => onChange({ price: Math.abs(n - modeled) < 0.005 ? undefined : n })} decimals={2} />
          {e.price !== undefined && <button type="button" className="link" onClick={() => onChange({ price: undefined })}>use modeled</button>}
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {e.price !== undefined ? `Pins ${c?.name ?? "the company"} at ${usd(e.price)} per share for ${e.year}; growth resumes from there.` : `Uses the modeled ${e.year} price, ${usd(modeled)} per share.`}
        {doubleTrigger ? ` Double-trigger RSUs settle here: ${yr && yr.inputs.rsuSharesVested > 0 ? `${shares(yr.inputs.rsuSharesVested)} units, ${usdCompact(yr.inputs.rsuIncome)} of wages in ${e.year}` : "none are time-vested by then"}.` : " No double-trigger RSUs depend on it."}
      </p>
    </div>
  );
}

function DateField({ value, fallback, onChange }: { value?: string; fallback: string; onChange: (d: string | undefined) => void }) {
  return <span className="input-wrap ei-date"><input type="date" value={value ?? fallback} onChange={(e) => onChange(e.target.value && e.target.value !== fallback ? e.target.value : undefined)} /></span>;
}

function ExerciseInspector({ profile, levers, years, event: e, crossovers, onChange, onRemove }: { profile: Profile; levers: Levers; years: number[]; event: Extract<ScenarioEvent, { kind: "exercise" }>; crossovers: AmtCrossover[]; onChange: (patch: Partial<ScenarioEvent>) => void; onRemove: () => void }) {
  const cross = crossovers.find((c) => c.year === e.year);
  const available = e.type === "iso" ? (cross?.available ?? 0) : sharesExercisable(profile, levers, "nso", e.year);
  const value = Math.min(e.shares, available);
  const hasMark = e.type === "iso" && !!cross && cross.available > 0 && cross.sharesBeforeAmt < cross.available;
  return (
    <div className="event-inspector">
      <div className="ei-head">
        <strong>Exercise {e.type.toUpperCase()}s</strong>
        <span className="muted">on</span>
        <DateField value={e.date} fallback={`${e.year}-01-01`} onChange={(d) => onChange({ date: d, ...(d ? { year: Number(d.slice(0, 4)) } : {}) })} />
        <span className="ei-year"><Select options={years.map((y) => ({ value: String(y), label: String(y) }))} value={String(e.year)} onChange={(y) => onChange({ year: Number(y), date: undefined })} /></span>
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

function SaleInspector({ profile, plan, years, event: e, result, onChange, onRemove, onSellToCover }: { profile: Profile; plan: PlanResult; years: number[]; event: Extract<ScenarioEvent, { kind: "sell" }>; result: SaleResult | undefined; onChange: (patch: Partial<ScenarioEvent>) => void; onRemove: () => void; onSellToCover: () => void }) {
  const yr = plan.years.find((y) => y.year === e.year);
  const lots: Lot[] = yr?.lotsBefore ?? [];
  const held = lots.reduce((s, l) => s + l.quantity, 0);
  const date = e.date ?? `${e.year}-12-31`;
  const explicit = !!e.lots;
  const sold = result?.shares ?? 0;
  const modeled = lots[0] ? lotPrice(profile, lots[0], e.year) : 0;
  const price = e.price ?? modeled;
  const pctOf = (n: number) => (held > 0 ? (n / held) * 100 : 0);
  const milestones = lotMilestones(lots, date).filter((m) => m.date <= `${e.year + 1}-12-31`).slice(0, 3);
  const tax = yr ? yr.lines.totalTax!.value : 0;
  const pickMyself = () => onChange({ lots: Object.fromEntries((result?.lots ?? []).map((l) => [l.lotId, l.shares])) });
  const setLot = (id: string, n: number) => onChange({ lots: { ...(e.lots ?? {}), [id]: Math.max(0, Math.round(n)) } });

  return (
    <div className="event-inspector sale">
      <div className="ei-head">
        <strong>Sell shares</strong>
        <span className="muted">on</span>
        <DateField value={e.date} fallback={`${e.year}-12-31`} onChange={(d) => onChange({ date: d, ...(d ? { year: Number(d.slice(0, 4)) } : {}) })} />
        <span className="ei-year"><Select options={years.map((y) => ({ value: String(y), label: String(y) }))} value={String(e.year)} onChange={(y) => onChange({ year: Number(y), date: undefined })} /></span>
        <span className="spacer" />
        <button type="button" className="link danger" onClick={onRemove}>Remove</button>
      </div>
      {held === 0 ? (
        <p className="muted small">Nothing to sell in {e.year}: no shares are held by then. Exercise options or wait for RSUs to settle first.</p>
      ) : (
        <>
          {!explicit && (
            <div className="lever-row">
              <div className="head">
                <span className="badge sell">SELL</span>
                <span className="lever-hint muted">lowest-tax lots first</span>
                <NumberInput value={Math.min(e.shares, held)} onChange={(n) => onChange({ shares: Math.max(0, Math.min(held, Math.round(n))) })} min={0} suffix="sh" />
              </div>
              <div className="track">
                <input type="range" className="range" min={0} max={held} step={held > 5000 ? 50 : 10} value={Math.min(e.shares, held)} style={{ "--pct": `${pctOf(Math.min(e.shares, held))}%` } as React.CSSProperties} onChange={(ev) => onChange({ shares: Number(ev.target.value) })} />
              </div>
              <div className="foot">
                <span>{shares(sold)} of {shares(held)} held</span>
                <span>at {usd(price)}/sh{e.price !== undefined ? " (yours)" : ` (modeled ${e.year} price)`}</span>
              </div>
            </div>
          )}
          {explicit && (
            <div className="lever-row">
              <div className="head"><span className="badge sell">SELL</span><span className="lever-hint muted">lots picked by hand · {shares(sold)} of {shares(held)} held at {usd(price)}/sh</span></div>
            </div>
          )}
          <div className="ei-row">
            <label className="ei-price">
              <span className="muted small">Price</span>
              <MoneyInput value={price} onChange={(n) => onChange({ price: Math.abs(n - modeled) < 0.005 ? undefined : n })} decimals={2} />
              {e.price !== undefined && <button type="button" className="link" onClick={() => onChange({ price: undefined })}>use modeled</button>}
            </label>
            <button type="button" className="btn" onClick={onSellToCover} title="Sell just enough that the proceeds pay this year's whole tax bill, including the tax on the sale">Sell enough to cover {e.year}'s tax</button>
            <button type="button" className="link" onClick={() => (explicit ? onChange({ lots: undefined }) : pickMyself())}>{explicit ? "Let the rule pick lots" : "Pick lots myself"}</button>
          </div>
          {result && result.shares > 0 && (
            <div className="sale-summary">
              <span><strong>{usdCompact(result.proceeds)}</strong> proceeds</span>
              {result.longTermGain !== 0 && <span><strong>{fmtDelta(result.longTermGain)}</strong> long-term</span>}
              {result.shortTermGain !== 0 && <span><strong>{fmtDelta(result.shortTermGain)}</strong> short-term</span>}
              {result.ordinaryIncome > 0 && <span><strong>{usdCompact(result.ordinaryIncome)}</strong> ordinary (disqualified ISOs)</span>}
              {result.amtAdjustment < 0 && <span><strong>{usdCompact(-result.amtAdjustment)}</strong> off AMTI</span>}
              <span><strong>{usdCompact(tax)}</strong> total tax in {e.year}</span>
            </div>
          )}
          {milestones.length > 0 && (
            <ul className="milestones">
              {milestones.map((m) => <li key={m.lotId + m.becomes}>{shares(m.shares)} sh of {m.label} turn <strong>{m.becomes}</strong> on {m.date}{m.date > date ? " · after this sale" : ""}</li>)}
            </ul>
          )}
          <details className="fold lots-fold" open={explicit}>
            <summary>Lots held on {date} · {lots.length}</summary>
            <div className="table-wrap">
              <table className="ledger lots">
                <thead><tr><th>Lot</th><th>Held</th><th>Basis</th><th>On {date}</th><th>{explicit ? "Sell" : "Sold"}</th></tr></thead>
                <tbody>
                  {lots.map((l) => {
                    const q = isQualifying(l, date);
                    const lt = isLongTerm(l, date);
                    const status = q === true ? "qualifying" : q === false ? (lt ? `long-term, qualifies ${qualifyingFrom(l)}` : `disqualifying until ${qualifyingFrom(l)}`) : lt ? "long-term" : `short-term until ${longTermFrom(l.acquired)}`;
                    const soldHere = result?.lots.find((x) => x.lotId === l.id)?.shares ?? 0;
                    return (
                      <tr key={l.id}>
                        <td>{l.label}</td>
                        <td>{shares(l.quantity)}</td>
                        <td>{usd(l.costBasis)}{l.amtBasis !== l.costBasis ? ` / AMT ${usd(l.amtBasis)}` : ""}</td>
                        <td className={q === false || (!lt && q === null) ? "warn" : ""}>{status}</td>
                        <td>{explicit ? <span className="input-wrap sm"><NumberInput value={e.lots?.[l.id] ?? 0} onChange={(n) => setLot(l.id, Math.min(l.quantity, n))} min={0} /></span> : shares(soldHere)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
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
    // A change to the value already in force is not a change; the sidebar still lists it for cleanup.
    if (getPath(profile, t.path) === v) continue;
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

/** Holding-period milestones per year: shares held at the start of the year that turn long-term or qualifying during it. */
export function milestoneMarkers(profile: Profile, plan: PlanResult, years: number[]): FactMarker[] {
  const out: FactMarker[] = [];
  years.forEach((y, i) => {
    const lots = i === 0 ? openingLots(profile) : (plan.years[i - 1]?.lotsEnd ?? []);
    const inYear = lotMilestones(lots, `${y}-01-01`).filter((m) => m.date.startsWith(String(y)));
    for (const becomes of ["long-term", "qualifying"] as const) {
      const ms = inYear.filter((m) => m.becomes === becomes);
      if (ms.length === 0) continue;
      const total = ms.reduce((s, m) => s + m.shares, 0);
      const first = ms[0]!.date;
      out.push({ id: `m-${y}-${becomes}`, year: y, label: `Turn ${becomes}`, detail: `${shares(total)} sh from ${first.slice(5)}`, milestone: true });
    }
  });
  return out;
}
