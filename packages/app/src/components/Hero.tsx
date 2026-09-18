import { useRef } from "react";
import type { PlanResult } from "@taxonomy/engine";
import { fmtDelta, pct, usd, usdCompact, usdHeadline } from "../format.ts";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber.ts";

function Delta({ value, lowerIsGood = true, unit = "usd" }: { value: number; lowerIsGood?: boolean; unit?: "usd" | "rate" }) {
  const text = fmtDelta(value, unit);
  if (!text) return <span className="delta muted">same as pinned</span>;
  const good = lowerIsGood ? value < 0 : value > 0;
  return <span className={"delta " + (good ? "good" : "bad")}>{text} vs pinned</span>;
}

/** The plan's two answers, tax and what is kept, then what the tax was made of. */
export function Hero({ plan, pinned, years, onBoomerang }: { plan: PlanResult; pinned: PlanResult | null; years: number[]; onBoomerang?: () => void }) {
  // Three quick clicks on the credit tile throw the boomerang.
  const clicks = useRef<number[]>([]);
  const creditClick = () => { const t = Date.now(); clicks.current = [...clicks.current.filter((c) => t - c < 1500), t]; if (clicks.current.length >= 3) { clicks.current = []; onBoomerang?.(); } };
  const t = plan.totals;
  const p = pinned?.totals;
  const total = useAnimatedNumber(t.totalTax);
  const kept = useAnimatedNumber(t.netCash);
  const span = `${years[0]}–${years[years.length - 1]}`;
  const showState = t.stateTax > 0 || (p?.stateTax ?? 0) > 0;
  return (
    <section className="card hero">
      <div>
        <div className="label">Total tax, {span}</div>
        <div className="big" title={usd(t.totalTax)}>{usdHeadline(total)}</div>
        {p && <div><Delta value={t.totalTax - p.totalTax} /></div>}
      </div>
      <div>
        <div className="label">Kept, {span} <span className="muted">· of {usdCompact(t.cashIn)} in</span></div>
        <div className={"big kept" + (kept < 0 ? " short" : "")} title={usd(t.netCash)}>{usdHeadline(kept)}</div>
        {p && <div><Delta value={t.netCash - p.netCash} lowerIsGood={false} /></div>}
      </div>
      <div className="tiles">
        <Tile label="Federal" value={t.federalTotal} pinned={p?.federalTotal} color="var(--series-regular)" />
        <Tile label="AMT paid" value={t.amt} pinned={p?.amt} color="var(--series-amt)" />
        <Tile label="AMT credit left" value={t.amtCreditCarryforwardEnd} pinned={p?.amtCreditCarryforwardEnd} color="var(--series-amt)" onClick={creditClick} />
        {showState && <Tile label="State" value={t.stateTax} pinned={p?.stateTax} color="var(--series-state)" />}
        <Tile label="Tax rate" hint="Tax as a share of income, counting the ISO spread as income" value={t.rateWithSpread} pinned={p?.rateWithSpread} color="var(--series-violet)" unit="rate" />
      </div>
    </section>
  );
}

function Tile({ label, hint, value, pinned, color, lowerIsGood = true, unit = "usd", onClick }: { label: string; hint?: string; value: number; pinned?: number; color: string; lowerIsGood?: boolean; unit?: "usd" | "rate"; onClick?: () => void }) {
  const shown = useAnimatedNumber(value);
  return (
    <div className="tile" style={{ "--tile": color } as React.CSSProperties} title={hint} onClick={onClick}>
      <div className="label">{label}</div>
      <div className="value" title={unit === "rate" ? undefined : usd(value)}>{unit === "rate" ? pct(shown) : usdHeadline(shown)}</div>
      {pinned !== undefined && <Delta value={value - pinned} lowerIsGood={lowerIsGood} unit={unit} />}
    </div>
  );
}
