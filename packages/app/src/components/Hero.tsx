import type { PlanResult } from "@taxonomy/engine";
import { fmtDelta, usd } from "../format.ts";

function Delta({ value, lowerIsGood = true }: { value: number; lowerIsGood?: boolean }) {
  const text = fmtDelta(value);
  if (!text) return <span className="delta muted">no change vs pinned</span>;
  const good = lowerIsGood ? value < 0 : value > 0;
  return <span className={"delta " + (good ? "good" : "bad")}>{text} vs pinned</span>;
}

export function Hero({ plan, pinned, years }: { plan: PlanResult; pinned: PlanResult | null; years: number[] }) {
  const t = plan.totals;
  const p = pinned?.totals;
  return (
    <section className="card hero">
      <div>
        <div className="label">Total tax, {years[0]}–{years[years.length - 1]}</div>
        <div className="big">{usd(t.totalTax)}</div>
        {p && <div><Delta value={t.totalTax - p.totalTax} /></div>}
      </div>
      <div className="tiles">
        <Tile label="Federal" value={t.federalTotal} pinned={p?.federalTotal} />
        <Tile label="AMT paid" value={t.amt} pinned={p?.amt} />
        <Tile label="AMT credit left" value={t.amtCreditCarryforwardEnd} pinned={p?.amtCreditCarryforwardEnd} />
        <Tile label="State" value={t.stateTax} pinned={p?.stateTax} />
      </div>
    </section>
  );
}

function Tile({ label, value, pinned, lowerIsGood = true }: { label: string; value: number; pinned?: number; lowerIsGood?: boolean }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{usd(value)}</div>
      {pinned !== undefined && <Delta value={value - pinned} lowerIsGood={lowerIsGood} />}
    </div>
  );
}
