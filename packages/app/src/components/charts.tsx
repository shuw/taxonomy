import type { ReactNode } from "react";
import { niceTicks, usdCompact } from "../format.ts";

export interface Margins { top: number; right: number; bottom: number; left: number; }

/** The shared layout of a year-column chart: margins, the column width, and the value scale. */
export function columnLayout(width: number, height: number, columns: number, max: number, m: Margins, maxBand = 260) {
  const band = Math.min(maxBand, (width - m.left - m.right) / columns);
  const ticks = max < 1 ? [0] : niceTicks(max);
  const top = Math.max(1, ticks[ticks.length - 1] ?? max);
  const plotH = height - m.top - m.bottom;
  const yOf = (v: number) => m.top + plotH - (v / top) * plotH;
  const baseY = m.top + plotH;
  const cx = (i: number) => m.left + band * i + band / 2;
  return { band, ticks, top, plotH, yOf, baseY, cx };
}

/** Horizontal grid lines with dollar labels on the left. */
export function AxisTicks({ ticks, yOf, left, right }: { ticks: number[]; yOf: (v: number) => number; left: number; right: number }) {
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={left} x2={right} y1={yOf(t)} y2={yOf(t)} />
          <text className="axis-label" x={left - 6} y={yOf(t) + 4} textAnchor="end">{usdCompact(t)}</text>
        </g>
      ))}
    </>
  );
}

/** A hover card next to a column, flipped to the left near the right edge so it stays inside the chart. */
export function ChartTooltip({ index, count, width, band, left, top, children }: { index: number; count: number; width: number; band: number; left: number; top: number; children: ReactNode }) {
  const style = index >= count - 2 ? { right: width - (left + band * index) + 6, top } : { left: left + band * (index + 1) - 6, top };
  return <div className="tooltip" style={style}>{children}</div>;
}

export function TooltipRow({ label, value, color, className }: { label: ReactNode; value: ReactNode; color?: string; className?: string }) {
  return (
    <div className={"row" + (className ? ` ${className}` : "")}>
      <span>{color && <span className="sw" style={{ background: color, display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6 }} />}{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function Legend({ items }: { items: { id: string; label: string; color: string; hatch?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((s) => <span key={s.id}><span className={"sw" + (s.hatch ? " hatch" : "")} style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}
