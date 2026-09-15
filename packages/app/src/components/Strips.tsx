import { useState } from "react";
import { useWidth } from "../useWidth.ts";
import type { PlanResult } from "@taxonomy/engine";
import { fmtDelta, niceTicks, usd, usdCompact } from "../format.ts";

interface Series { id: string; label: string; color: string; value: (y: PlanResult["years"][number]) => number; }

const TAX_SERIES: Series[] = [
  { id: "regular", label: "Regular tax (after AMT credit)", color: "var(--series-regular)", value: (y) => y.lines.regularTax!.value - y.lines.amtCreditUsed!.value },
  { id: "amt", label: "AMT", color: "var(--series-amt)", value: (y) => y.lines.amt!.value },
  { id: "surtax", label: "NIIT + Medicare", color: "var(--series-surtax)", value: (y) => y.lines.niit!.value + y.lines.additionalMedicare!.value },
];
const STATE_SERIES: Series = { id: "state", label: "State", color: "var(--series-state)", value: (y) => y.lines.stateTax!.value };

/** State tax as the lines the state module wrote, so Washington's two taxes show apart. */
function taxSeries(plan: PlanResult): Series[] {
  const lines = plan.years[0]?.lines ?? {};
  if (lines.stateCapitalGainsTax && lines.stateMillionairesTax) {
    return [
      ...TAX_SERIES,
      { id: "stateCg", label: lines.stateCapitalGainsTax.label, color: "var(--series-state)", value: (y) => y.lines.stateCapitalGainsTax?.value ?? 0 },
      { id: "stateM", label: lines.stateMillionairesTax.label, color: "var(--series-state-2)", value: (y) => y.lines.stateMillionairesTax?.value ?? 0 },
    ];
  }
  return [...TAX_SERIES, { ...STATE_SERIES, label: lines.stateTax?.label ?? "State" }];
}
const CREDIT_SERIES: Series[] = [
  { id: "credit", label: "Credit on hand at year end", color: "var(--series-amt)", value: (y) => y.lines.amtCreditCarryforwardOut!.value },
];

interface StripProps { plan: PlanResult; pinned: PlanResult | null; focusYear: number; onFocus: (y: number) => void; }

export const TaxStrip = (p: StripProps) => <ColumnStrip {...p} series={taxSeries(p.plan)} height={230} />;
export const CreditStrip = (p: StripProps) => <ColumnStrip {...p} series={CREDIT_SERIES} height={170} />;

const GAP = 2;
/** Columns grow with the card up to this width; bars take a share of the column. */
export const MAX_BAND = 260;
const barWidth = (band: number) => Math.round(Math.min(48, Math.max(24, band * 0.28)));

/** A rounded-top rectangle grown from a baseline (square bottom corners). */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function ColumnStrip({ plan, pinned, focusYear, onFocus, series, height }: StripProps & { series: Series[]; height: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const years = plan.years;
  const m = { top: 24, right: 12, bottom: 28, left: 46 };
  const band = Math.min(MAX_BAND, (width - m.left - m.right) / years.length);
  const BAR = barWidth(band);
  const totals = years.map((y) => series.reduce((s, sr) => s + sr.value(y), 0));
  const pinnedTotals = pinned ? pinned.years.map((y) => series.reduce((s, sr) => s + sr.value(y), 0)) : null;
  const max = Math.max(...totals, ...(pinnedTotals ?? []));
  const ticks = max < 1 ? [0] : niceTicks(max);
  const top = Math.max(1, ticks[ticks.length - 1] ?? max);
  const plotH = height - m.top - m.bottom;
  const yOf = (v: number) => m.top + plotH - (v / top) * plotH;
  const baseY = m.top + plotH;

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Tax by year">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={m.left} x2={width - m.right} y1={yOf(t)} y2={yOf(t)} />
            <text className="axis-label" x={m.left - 6} y={yOf(t) + 4} textAnchor="end">{usdCompact(t)}</text>
          </g>
        ))}
        {years.map((y, i) => {
          const cx = m.left + band * i + band / 2;
          const hasPin = pinnedTotals !== null;
          const barX = hasPin ? cx + 2 : cx - BAR / 2;
          const pinX = cx - 2 - BAR;
          let acc = 0;
          const segs = series.map((sr) => {
            const v = sr.value(y);
            const y0 = yOf(acc);
            const y1 = yOf(acc + v);
            acc += v;
            return { sr, v, y0, y1 };
          }).filter((s) => s.v > 0);
          const lastIdx = segs.length - 1;
          return (
            <g key={y.year}>
              {hasPin && pinnedTotals![i]! > 0 && (
                <path d={topRounded(pinX, yOf(pinnedTotals![i]!), BAR, baseY - yOf(pinnedTotals![i]!), 4)} fill="var(--series-pinned)" />
              )}
              {segs.map((s, j) => {
                const h = Math.max(0, s.y0 - s.y1 - (j < lastIdx ? GAP : 0));
                const yTop = s.y1 + (j < lastIdx ? GAP : 0);
                return j === lastIdx
                  ? <path key={s.sr.id} d={topRounded(barX, yTop, BAR, h, 4)} fill={s.sr.color} />
                  : <rect key={s.sr.id} x={barX} y={yTop} width={BAR} height={h} fill={s.sr.color} />;
              })}
              {totals[i]! > 0 && <text className="cap-label" x={hasPin ? cx : barX + BAR / 2} y={yOf(Math.max(totals[i]!, pinnedTotals?.[i] ?? 0)) - 5} textAnchor="middle">{usdCompact(totals[i]!)}</text>}
              <text className={"year-label" + (y.year === focusYear ? " focus" : "")} x={cx} y={height - 8} textAnchor="middle" onClick={() => onFocus(y.year)}>{y.year}</text>
              <rect x={m.left + band * i} y={m.top} width={band} height={plotH + m.bottom} fill="transparent" onMouseEnter={() => { setHover(i); onFocus(y.year); }} onClick={() => onFocus(y.year)} style={{ cursor: "pointer" }} />
            </g>
          );
        })}
        <line className="baseline" x1={m.left} x2={width - m.right} y1={baseY} y2={baseY} />
      </svg>
      {hover !== null && (
        <div className="tooltip" style={hover >= years.length - 2
          ? { right: width - (m.left + band * hover) + 6, top: m.top }
          : { left: m.left + band * (hover + 1) - 6, top: m.top }}>
          <div className="row"><strong>{years[hover]!.year}</strong></div>
          {series.map((sr) => (
            <div className="row" key={sr.id}><span><span className="sw" style={{ background: sr.color, display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6 }} />{sr.label}</span><span>{usd(sr.value(years[hover]!))}</span></div>
          ))}
          {series.length > 1 && <div className="row total"><span>Total</span><span>{usd(totals[hover]!)}</span></div>}
          {pinnedTotals && <div className="row muted"><span>vs pinned</span><span>{fmtDelta(totals[hover]! - pinnedTotals[hover]!) || "same"}</span></div>}
        </div>
      )}
      {(series.length > 1 || pinned) && (
        <div className="legend">
          {series.length > 1 && series.map((sr) => <span key={sr.id}><span className="sw" style={{ background: sr.color }} />{sr.label}</span>)}
          {pinned && <span><span className="sw" style={{ background: "var(--series-pinned)" }} />Pinned scenario</span>}
        </div>
      )}
    </div>
  );
}

/** Cash by year: what arrives (wages, sale proceeds) against what leaves (exercise cost, tax), with the net on top. */
export function CashStrip({ plan, pinned, focusYear, onFocus }: { plan: PlanResult; pinned: PlanResult | null; focusYear: number; onFocus: (y: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const years = plan.years;
  const height = 230;
  const m = { top: 24, right: 12, bottom: 28, left: 46 };
  const band = Math.min(MAX_BAND, (width - m.left - m.right) / years.length);
  const bar = Math.round(Math.min(40, Math.max(18, band * 0.22)));
  const v = (y: PlanResult["years"][number], id: string) => y.lines[id]?.value ?? 0;
  const rows = years.map((y) => ({
    wages: y.inputs.salarySelf + y.inputs.salarySpouse,
    proceeds: y.inputs.saleProceeds,
    exercise: v(y, "exerciseCost"),
    tax: v(y, "totalTax"),
    net: v(y, "netCash"),
    agi: v(y, "agi"),
    pinnedNet: pinned ? (pinned.years.find((p) => p.year === y.year)?.lines.netCash?.value ?? null) : null,
  }));
  const max = Math.max(1, ...rows.map((r) => Math.max(r.wages + r.proceeds, r.exercise + r.tax)));
  const ticks = niceTicks(max);
  const top = Math.max(1, ticks[ticks.length - 1] ?? max);
  const plotH = height - m.top - m.bottom;
  const yOf = (x: number) => m.top + plotH - (x / top) * plotH;
  const baseY = m.top + plotH;
  const IN = [{ key: "wages", label: "Salary and bonus", color: "var(--series-regular)" }, { key: "proceeds", label: "Shares sold", color: "var(--series-surtax)" }] as const;
  const OUT = [{ key: "exercise", label: "Exercise cost", color: "var(--series-violet)" }, { key: "tax", label: "Tax", color: "var(--series-amt)" }] as const;
  const stack = (x: number, parts: readonly { key: "wages" | "proceeds" | "exercise" | "tax"; color: string }[], r: (typeof rows)[number]) => {
    let acc = 0;
    return parts.map((p, j) => {
      const val = r[p.key];
      const y1 = yOf(acc + val), y0 = yOf(acc);
      acc += val;
      const h = Math.max(0, y0 - y1 - (j < parts.length - 1 && val > 0 ? GAP : 0));
      return val > 0 ? <rect key={p.key} x={x} y={y1 + (j < parts.length - 1 ? GAP : 0)} width={bar} height={h} fill={p.color} rx={3} /> : null;
    });
  };
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Cash by year">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={m.left} x2={width - m.right} y1={yOf(t)} y2={yOf(t)} />
            <text className="axis-label" x={m.left - 6} y={yOf(t) + 4} textAnchor="end">{usdCompact(t)}</text>
          </g>
        ))}
        {years.map((y, i) => {
          const r = rows[i]!;
          const cx = m.left + band * i + band / 2;
          const inX = cx - bar - 3, outX = cx + 3;
          return (
            <g key={y.year}>
              {stack(inX, IN, r)}
              {stack(outX, OUT, r)}
              <text className={"cap-label" + (r.net < 0 ? " neg" : "")} x={cx} y={yOf(Math.max(r.wages + r.proceeds, r.exercise + r.tax)) - (r.pinnedNet !== null ? 17 : 5)} textAnchor="middle">{r.net >= 0 ? "+" : "−"}{usdCompact(Math.abs(r.net))}</text>
              {r.pinnedNet !== null && <text className="cap-label pinned" x={cx} y={yOf(Math.max(r.wages + r.proceeds, r.exercise + r.tax)) - 5} textAnchor="middle">pinned {r.pinnedNet >= 0 ? "+" : "−"}{usdCompact(Math.abs(r.pinnedNet))}</text>}
              <text className={"year-label" + (y.year === focusYear ? " focus" : "")} x={cx} y={height - 8} textAnchor="middle" onClick={() => onFocus(y.year)}>{y.year}</text>
              <rect x={m.left + band * i} y={m.top} width={band} height={plotH + m.bottom} fill="transparent" onMouseEnter={() => { setHover(i); onFocus(y.year); }} onClick={() => onFocus(y.year)} style={{ cursor: "pointer" }} />
            </g>
          );
        })}
        <line className="baseline" x1={m.left} x2={width - m.right} y1={baseY} y2={baseY} />
      </svg>
      {hover !== null && (() => { const r = rows[hover]!; return (
        <div className="tooltip" style={hover >= years.length - 2 ? { right: width - (m.left + band * hover) + 6, top: m.top } : { left: m.left + band * (hover + 1) - 6, top: m.top }}>
          <div className="row"><strong>{years[hover]!.year}</strong></div>
          {IN.map((p) => <div className="row" key={p.key}><span><span className="sw" style={{ background: p.color, display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6 }} />{p.label}</span><span>{usd(r[p.key])}</span></div>)}
          {OUT.map((p) => <div className="row" key={p.key}><span><span className="sw" style={{ background: p.color, display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6 }} />{p.label}</span><span>−{usd(r[p.key])}</span></div>)}
          <div className="row total"><span>Net cash</span><span>{fmtDelta(r.net) || "$0"}</span></div>
          {r.pinnedNet !== null && <div className="row muted"><span>vs pinned</span><span>{fmtDelta(r.net - r.pinnedNet) || "same"}</span></div>}
          <div className="row muted"><span>Income for tax (AGI)</span><span>{usd(r.agi)}</span></div>
        </div>
      ); })()}
      <div className="legend">
        {[...IN, ...OUT].map((p) => <span key={p.key}><span className="sw" style={{ background: p.color }} />{p.label}</span>)}
      </div>
    </div>
  );
}
