import { useState } from "react";
import { useWidth } from "../useWidth.ts";
import type { AmtCrossover, SweepPoint } from "@taxonomy/engine";
import { niceTicks, shares, usd, usdCompact } from "../format.ts";

interface Props { sweep: SweepPoint[]; crossover: AmtCrossover; current: number; onChange: (shares: number) => void; }

export function SweepChart({ sweep, crossover, current, onChange }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>(460);
  const height = 170;
  const m = { top: 18, right: 14, bottom: 28, left: 46 };
  const plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
  const maxShares = Math.max(1, crossover.available);
  // Extra tax across the whole plan versus exercising nothing this year: what the AMT costs once the credit comes back.
  const base = sweep[0]?.planTotalTax ?? 0;
  const extra = (p: SweepPoint) => Math.max(0, p.planTotalTax - base);
  const maxAmt = Math.max(1, ...sweep.map((p) => p.amt));
  const ticks = niceTicks(maxAmt, 3);
  const top = ticks[ticks.length - 1] ?? maxAmt;
  const xOf = (s: number) => m.left + (s / maxShares) * plotW;
  const yOf = (v: number) => m.top + plotH - (v / top) * plotH;
  const baseY = m.top + plotH;
  const line = sweep.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.shares)},${yOf(p.amt)}`).join(" ");
  const last = sweep[sweep.length - 1];
  const perShare = last && last.shares > crossover.sharesBeforeAmt ? last.amt / (last.shares - crossover.sharesBeforeAmt) : 0;
  const returns = last ? Math.max(0, last.amt - extra(last)) : 0;
  const beyond = sweep.filter((p) => p.shares >= crossover.sharesBeforeAmt);
  const area = beyond.length > 1
    ? `M${xOf(crossover.sharesBeforeAmt)},${baseY} L${xOf(crossover.sharesBeforeAmt)},${yOf(0)} ` + beyond.map((p) => `L${xOf(p.shares)},${yOf(p.amt)}`).join(" ") + ` L${xOf(beyond[beyond.length - 1]!.shares)},${baseY} Z`
    : "";
  const cur = Math.min(current, maxShares);
  const curAmt = interp(sweep, cur);
  const hp = hover === null ? null : sweep[hover]!;

  if (crossover.available === 0) return <div className="muted" style={{ padding: 20 }}>No shares left to exercise in {crossover.year}.</div>;

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`AMT in ${crossover.year} as shares exercised varies`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * width;
          const s = ((x - m.left) / plotW) * maxShares;
          let best = 0;
          for (let i = 1; i < sweep.length; i++) if (Math.abs(sweep[i]!.shares - s) < Math.abs(sweep[best]!.shares - s)) best = i;
          setHover(best);
        }}
        onClick={() => { if (hp) onChange(hp.shares); }}
        style={{ cursor: "pointer" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={m.left} x2={width - m.right} y1={yOf(t)} y2={yOf(t)} />
            <text className="axis-label" x={m.left - 6} y={yOf(t) + 4} textAnchor="end">{usdCompact(t)}</text>
          </g>
        ))}
        {area && <path d={area} fill="var(--series-amt)" opacity={0.1} />}
        <path d={line} fill="none" stroke="var(--series-amt)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {crossover.sharesBeforeAmt < crossover.available && (
          <g>
            <line x1={xOf(crossover.sharesBeforeAmt)} x2={xOf(crossover.sharesBeforeAmt)} y1={m.top} y2={baseY} stroke="var(--ink-2)" strokeWidth={1} />
            <text className="cap-label" x={xOf(crossover.sharesBeforeAmt) + 5} y={m.top + 10}>AMT starts at {shares(crossover.sharesBeforeAmt)} sh</text>
          </g>
        )}
        {hp && <line x1={xOf(hp.shares)} x2={xOf(hp.shares)} y1={m.top} y2={baseY} stroke="var(--grid)" strokeWidth={1} />}
        <circle cx={xOf(cur)} cy={yOf(curAmt)} r={5} fill="var(--series-amt)" stroke="var(--surface)" strokeWidth={2} />
        {cur > 0 && <text className="cap-label" x={xOf(cur) + (cur > maxShares * 0.7 ? -8 : 8)} y={yOf(curAmt) - 8} textAnchor={cur > maxShares * 0.7 ? "end" : "start"}>now: {shares(cur)} sh · {usdCompact(curAmt)}</text>}
        <line className="baseline" x1={m.left} x2={width - m.right} y1={baseY} y2={baseY} />
        {[0, 0.5, 1].map((f) => <text key={f} className="axis-label" x={xOf(f * maxShares)} y={height - 8} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}>{f === 0 ? "0" : f === 1 ? `all ${shares(maxShares)}` : shares(f * maxShares)}{f === 0.5 ? ` ISO shares exercised in ${crossover.year}` : ""}</text>)}
      </svg>
      {hp && (
        <div className="tooltip" style={hp.shares > maxShares * 0.6 ? { right: width - xOf(hp.shares) + 14, top: m.top } : { left: xOf(hp.shares) + 14, top: m.top }}>
          <div className="row"><strong>{shares(hp.shares)} shares</strong></div>
          <div className="row"><span>AMT this year</span><span>{usd(hp.amt)}</span></div>
          <div className="row"><span>Tax this year</span><span>{usd(hp.totalTax)}</span></div>
          <div className="row"><span>Extra tax over the plan</span><span>{usd(extra(hp))}</span></div>
          <div className="row"><span>Credit unused at end</span><span>{usd(hp.amtCreditCarryforwardEnd)}</span></div>
          <div className="row muted"><span>click to set</span></div>
        </div>
      )}
      <p className="muted small sweep-reading">
        {crossover.sharesBeforeAmt >= crossover.available
          ? `All ${shares(crossover.available)} exercisable shares fit under the AMT line this year.`
          : `AMT-free up to ${shares(crossover.sharesBeforeAmt)} shares; about ${usd(perShare)} per share after that.` + (last ? ` Exercising all ${shares(last.shares)} means ${usdCompact(last.amt)} of AMT in ${crossover.year}, of which ${returns < 1000 ? "almost none" : usdCompact(returns)} comes back as credit by the end of the plan.` : "")}
      </p>
    </div>
  );
}

function interp(sweep: SweepPoint[], s: number): number {
  for (let i = 1; i < sweep.length; i++) {
    const a = sweep[i - 1]!, b = sweep[i]!;
    if (s <= b.shares) {
      const t = b.shares === a.shares ? 0 : (s - a.shares) / (b.shares - a.shares);
      return a.amt + t * (b.amt - a.amt);
    }
  }
  return sweep[sweep.length - 1]?.amt ?? 0;
}
