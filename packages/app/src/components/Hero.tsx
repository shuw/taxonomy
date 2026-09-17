import type { PlanResult } from "@taxonomy/engine";
import { fmtDelta, usd } from "../format.ts";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber.ts";

function Delta({ value, lowerIsGood = true }: { value: number; lowerIsGood?: boolean }) {
  const text = fmtDelta(value);
  if (!text) return <span className="delta muted">no change vs pinned</span>;
  const good = lowerIsGood ? value < 0 : value > 0;
  return <span className={"delta " + (good ? "good" : "bad")}>{text} vs pinned</span>;
}

export function Hero({ plan, pinned, years }: { plan: PlanResult; pinned: PlanResult | null; years: number[] }) {
  const t = plan.totals;
  const p = pinned?.totals;
  const total = useAnimatedNumber(t.totalTax);
  return (
    <section className="card hero">
      <div>
        <div className="label">Total tax, {years[0]}–{years[years.length - 1]}</div>
        <div className="big">{usd(total)}</div>
        {p && <div><Delta value={t.totalTax - p.totalTax} /></div>}
      </div>
      <div className="tiles">
        <Tile label="Federal" value={t.federalTotal} pinned={p?.federalTotal} color="var(--series-regular)" />
        <Tile label="AMT paid" value={t.amt} pinned={p?.amt} color="var(--series-amt)" />
        <Tile label="AMT credit left" value={t.amtCreditCarryforwardEnd} pinned={p?.amtCreditCarryforwardEnd} color="var(--series-amt)" />
        <Tile label="State" value={t.stateTax} pinned={p?.stateTax} color="var(--series-state)" />
      </div>
      <p className="fine">For understanding, not advice. These are estimates from a model of the rules; confirm anything you act on with a tax professional.</p>
    </section>
  );
}

function Tile({ label, value, pinned, color, lowerIsGood = true }: { label: string; value: number; pinned?: number; color: string; lowerIsGood?: boolean }) {
  const shown = useAnimatedNumber(value);
  return (
    <div className="tile" style={{ "--tile": color } as React.CSSProperties}>
      <div className="label">{label}</div>
      <div className="value">{usd(shown)}</div>
      {pinned !== undefined && <Delta value={value - pinned} lowerIsGood={lowerIsGood} />}
    </div>
  );
}
