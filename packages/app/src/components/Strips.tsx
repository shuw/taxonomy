import { useState } from "react";
import { useWidth } from "../useWidth.ts";
import type { PlanResult } from "@taxonomy/engine";
import { fmtDelta, usd, usdCompact } from "../format.ts";
import { AxisTicks, ChartTooltip, Legend, TooltipRow, columnLayout } from "./charts.tsx";

interface Series { id: string; label: string; color: string; value: (y: PlanResult["years"][number]) => number; /** Draw with a hatch over the color instead of a solid fill. */ hatch?: boolean; }

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

interface StripProps {
  plan: PlanResult; pinned: PlanResult | null; focusYear: number;
  /** Hovering a year focuses it. */
  onFocus: (y: number) => void;
  /** Clicking a year is a firmer choice: the app also drops a selection that belongs to another year. */
  onPick?: (y: number) => void;
}

export const TaxStrip = (p: StripProps) => <ColumnStrip {...p} series={taxSeries(p.plan)} height={230} />;

/** Where each year's cash goes: tax at the bottom, exercise cost, then what is kept; a red line marks cash in when a year runs short. */
function combinedSeries(plan: PlanResult): Series[] {
  const tax = taxSeries(plan);
  const cashIn = (y: PlanResult["years"][number]) => y.lines.cashIn?.value ?? 0;
  const outOf = (y: PlanResult["years"][number]) => (y.lines.totalTax?.value ?? 0) + (y.lines.exerciseCost?.value ?? 0);
  return [
    ...tax,
    { id: "exercise", label: "Exercise cost", color: "var(--series-violet)", value: (y) => y.lines.exerciseCost?.value ?? 0 },
    { id: "kept", label: "Kept", color: "var(--series-kept)", hatch: true, value: (y) => Math.max(0, cashIn(y) - outOf(y)) },
  ];
}
export const CombinedStrip = (p: StripProps) => (
  <ColumnStrip {...p} series={combinedSeries(p.plan)} height={240} totalLabel="Net cash" capLabel={(y) => { const n = y.lines.netCash?.value ?? 0; return `${n < 0 ? "−" : "+"}${usdCompact(Math.abs(n))}`; }}
    capLines={(y) => { const n = y.lines.netCash?.value ?? 0; return [{ text: n < 0 ? `−${usdCompact(-n)} short` : `${usdCompact(n)} kept`, className: n < 0 ? "neg" : "kept" }, { text: `${usdCompact(y.lines.totalTax?.value ?? 0)} tax`, className: "tax" }]; }}
    marker={(y) => { const n = y.lines.netCash?.value ?? 0; return n < 0 ? { value: y.lines.cashIn?.value ?? 0, label: "cash in" } : null; }} />
);
export const CreditStrip = (p: StripProps) => <ColumnStrip {...p} series={CREDIT_SERIES} height={170} />;

const GAP = 2;
/** Columns grow with the card up to this width; bars take a share of the column. */
export const MAX_BAND = 260;
const barWidth = (band: number) => Math.round(Math.min(48, Math.max(24, band * 0.28)));

/** A rounded-top rectangle grown from a baseline (square bottom corners). */
/** A bar rounded at the top only, as rects so height changes can animate. */
function TopRounded({ x, y, w, h, r, fill }: { x: number; y: number; w: number; h: number; r: number; fill: string }) {
  const rr = Math.min(r, h, w / 2);
  return (
    <>
      <rect className="bar" x={x} y={y} width={w} height={h} rx={rr} fill={fill} />
      {h > rr && <rect className="bar" x={x} y={y + h - rr} width={w} height={rr} fill={fill} />}
    </>
  );
}

/** The soft band behind the focused year; it slides when the focus moves. */
function FocusBand({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect className="focus-band" x={x + 2} y={y} width={Math.max(0, w - 4)} height={h} rx={10} />;
}

function ColumnStrip({ plan, pinned, focusYear, onFocus, onPick = onFocus, series, height, totalLabel = "Total", capLabel, capLines, marker }: StripProps & { series: Series[]; height: number; totalLabel?: string; capLabel?: (y: PlanResult["years"][number]) => string; capLines?: (y: PlanResult["years"][number]) => { text: string; className: string }[]; marker?: (y: PlanResult["years"][number]) => { value: number; label: string } | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const years = plan.years;
  const m = { top: capLines ? 36 : 24, right: 12, bottom: 28, left: 46 };
  const totals = years.map((y) => series.reduce((s, sr) => s + sr.value(y), 0));
  const pinnedTotals = pinned ? pinned.years.map((y) => series.reduce((s, sr) => s + sr.value(y), 0)) : null;
  const { band, ticks, plotH, yOf, baseY } = columnLayout(width, height, years.length, Math.max(...totals, ...(pinnedTotals ?? [])), m, MAX_BAND);
  const BAR = barWidth(band);

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="By year">
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--series-kept)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="2" /></pattern>
        </defs>
        {years.some((y) => y.year === focusYear) && <FocusBand x={m.left + band * years.findIndex((y) => y.year === focusYear)} y={m.top - 4} w={band} h={plotH + m.bottom + 2} />}
        <AxisTicks ticks={ticks} yOf={yOf} left={m.left} right={width - m.right} />
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
                <TopRounded x={pinX} y={yOf(pinnedTotals![i]!)} w={BAR} h={baseY - yOf(pinnedTotals![i]!)} r={4} fill="var(--series-pinned)" />
              )}
              {segs.map((s, j) => {
                const h = Math.max(0, s.y0 - s.y1 - (j < lastIdx ? GAP : 0));
                const yTop = s.y1 + (j < lastIdx ? GAP : 0);
                const fill = s.sr.hatch ? "url(#hatch)" : s.sr.color;
                return j === lastIdx
                  ? <TopRounded key={s.sr.id} x={barX} y={yTop} w={BAR} h={h} r={4} fill={fill} />
                  : <rect className="bar" key={s.sr.id} x={barX} y={yTop} width={BAR} height={h} fill={fill} />;
              })}
              {(() => { const mk = marker?.(y); return mk ? <g><line x1={barX - 6} x2={barX + BAR + 6} y1={yOf(mk.value)} y2={yOf(mk.value)} stroke="var(--bad)" strokeWidth={2} /><text className="cap-label neg" x={barX + BAR + 8} y={yOf(mk.value) + 4}>{mk.label}</text></g> : null; })()}
              {totals[i]! > 0 && !capLines && <text className={"cap-label" + (capLabel?.(y).startsWith("−") ? " neg" : "")} x={hasPin ? cx : barX + BAR / 2} y={yOf(Math.max(totals[i]!, pinnedTotals?.[i] ?? 0)) - 5} textAnchor="middle">{capLabel ? capLabel(y) : usdCompact(totals[i]!)}</text>}
              {totals[i]! > 0 && capLines && capLines(y).map((l, k, all) => <text key={k} className={"cap-label " + l.className} x={hasPin ? cx : barX + BAR / 2} y={yOf(Math.max(totals[i]!, pinnedTotals?.[i] ?? 0)) - 5 - (all.length - 1 - k) * 13} textAnchor="middle">{l.text}</text>)}
              <text className={"year-label" + (y.year === focusYear ? " focus" : "")} x={cx} y={height - 8} textAnchor="middle" onClick={() => onPick(y.year)}>{y.year}</text>
              <rect x={m.left + band * i} y={m.top} width={band} height={plotH + m.bottom} fill="transparent" onMouseEnter={() => { setHover(i); onFocus(y.year); }} onClick={() => onPick(y.year)} style={{ cursor: "pointer" }} />
            </g>
          );
        })}
        <line className="baseline" x1={m.left} x2={width - m.right} y1={baseY} y2={baseY} />
      </svg>
      {hover !== null && (
        <ChartTooltip index={hover} width={width} band={band} left={m.left} height={height}>
          <div className="row"><strong>{years[hover]!.year}</strong></div>
          {series.map((sr) => <TooltipRow key={sr.id} label={sr.label} color={sr.color} value={usd(sr.value(years[hover]!))} />)}
          {series.length > 1 && !capLabel && <TooltipRow className="total" label={totalLabel} value={usd(totals[hover]!)} />}
          {capLabel && <TooltipRow className="total" label={totalLabel} value={fmtDelta(years[hover]!.lines.netCash?.value ?? 0) || "$0"} />}
          {capLabel && <TooltipRow className="muted" label="Cash in" value={usd(years[hover]!.lines.cashIn?.value ?? 0)} />}
          {pinnedTotals && !capLabel && <TooltipRow className="muted" label="vs pinned" value={fmtDelta(totals[hover]! - pinnedTotals[hover]!) || "same"} />}
          {pinnedTotals && capLabel && <TooltipRow className="muted" label="vs pinned" value={fmtDelta((years[hover]!.lines.netCash?.value ?? 0) - (pinned!.years[hover]?.lines.netCash?.value ?? 0)) || "same"} />}
        </ChartTooltip>
      )}
      {(series.length > 1 || pinned) && <Legend items={[...(series.length > 1 ? series : []), ...(pinned ? [{ id: "pinned", label: "Pinned scenario", color: "var(--series-pinned)" }] : [])]} />}
    </div>
  );
}

/** Cash by year: what arrives (wages, sale proceeds) against what leaves (exercise cost, tax), with the net on top. */
export function CashStrip({ plan, pinned, focusYear, onFocus, onPick = onFocus }: StripProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const years = plan.years;
  const height = 230;
  const m = { top: 24, right: 12, bottom: 28, left: 46 };
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
  const { band, ticks, plotH, yOf, baseY } = columnLayout(width, height, years.length, Math.max(1, ...rows.map((r) => Math.max(r.wages + r.proceeds, r.exercise + r.tax))), m, MAX_BAND);
  const bar = Math.round(Math.min(40, Math.max(18, band * 0.22)));
  const IN = [{ key: "wages", label: "Salary and bonus", color: "var(--series-regular)" }, { key: "proceeds", label: "Shares sold", color: "var(--series-surtax)" }] as const;
  const OUT = [{ key: "exercise", label: "Exercise cost", color: "var(--series-violet)" }, { key: "tax", label: "Tax", color: "var(--series-amt)" }] as const;
  const stack = (x: number, parts: readonly { key: "wages" | "proceeds" | "exercise" | "tax"; color: string }[], r: (typeof rows)[number]) => {
    let acc = 0;
    return parts.map((p, j) => {
      const val = r[p.key];
      const y1 = yOf(acc + val), y0 = yOf(acc);
      acc += val;
      const h = Math.max(0, y0 - y1 - (j < parts.length - 1 && val > 0 ? GAP : 0));
      return val > 0 ? <rect className="bar" key={p.key} x={x} y={y1 + (j < parts.length - 1 ? GAP : 0)} width={bar} height={h} fill={p.color} rx={3} /> : null;
    });
  };
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Cash by year">
        {years.some((y) => y.year === focusYear) && <FocusBand x={m.left + band * years.findIndex((y) => y.year === focusYear)} y={m.top - 4} w={band} h={plotH + m.bottom + 2} />}
        <AxisTicks ticks={ticks} yOf={yOf} left={m.left} right={width - m.right} />
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
              <text className={"year-label" + (y.year === focusYear ? " focus" : "")} x={cx} y={height - 8} textAnchor="middle" onClick={() => onPick(y.year)}>{y.year}</text>
              <rect x={m.left + band * i} y={m.top} width={band} height={plotH + m.bottom} fill="transparent" onMouseEnter={() => { setHover(i); onFocus(y.year); }} onClick={() => onPick(y.year)} style={{ cursor: "pointer" }} />
            </g>
          );
        })}
        <line className="baseline" x1={m.left} x2={width - m.right} y1={baseY} y2={baseY} />
      </svg>
      {hover !== null && (() => { const r = rows[hover]!; return (
        <ChartTooltip index={hover} width={width} band={band} left={m.left} height={height}>
          <div className="row"><strong>{years[hover]!.year}</strong></div>
          {IN.map((p) => <TooltipRow key={p.key} label={p.label} color={p.color} value={usd(r[p.key])} />)}
          {OUT.map((p) => <TooltipRow key={p.key} label={p.label} color={p.color} value={`−${usd(r[p.key])}`} />)}
          <TooltipRow className="total" label="Net cash" value={fmtDelta(r.net) || "$0"} />
          {r.pinnedNet !== null && <TooltipRow className="muted" label="vs pinned" value={fmtDelta(r.net - r.pinnedNet) || "same"} />}
          <TooltipRow className="muted" label="Income for tax (AGI)" value={usd(r.agi)} />
        </ChartTooltip>
      ); })()}
      <Legend items={[...IN, ...OUT].map((p) => ({ id: p.key, label: p.label, color: p.color }))} />
    </div>
  );
}
