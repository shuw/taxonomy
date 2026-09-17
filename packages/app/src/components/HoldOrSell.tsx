import { Info } from "./Info.tsx";
import type { HoldOrSell } from "@taxonomy/engine";
import { shares, usd, usdCompact } from "../format.ts";

/** Two paths for one year's ISO exercise, side by side. */
export function HoldOrSellCard({ h, companyName }: { h: HoldOrSell; companyName?: string }) {
  const better = h.hold.netOverPlan - h.sell.netOverPlan;
  const rows: { label: string; hold: string; sell: string; hint?: string }[] = [
    { label: "Sold", hold: `${h.hold.saleYear} at ${usd(h.holdPrice)}`, sell: `${h.year} at ${usd(h.sellPrice)}`, hint: "the modeled price in each year" },
    { label: `Tax in ${h.year}`, hold: usdCompact(h.hold.taxInYear), sell: usdCompact(h.sell.taxInYear) },
    { label: `Cash needed in ${h.year}`, hold: usdCompact(h.hold.cashNeeded), sell: usdCompact(Math.max(0, h.sell.cashNeeded)), hint: "exercise cost plus that year's tax, less same-day proceeds" },
    { label: "Proceeds", hold: usdCompact(h.hold.proceeds), sell: usdCompact(h.sell.proceeds) },
    { label: "Tax from this exercise, over the plan", hold: usdCompact(h.hold.taxOverPlan), sell: usdCompact(h.sell.taxOverPlan), hint: "versus not exercising; AMT credit that returns within the plan is netted" },
    { label: "Net, over the plan", hold: usdCompact(h.hold.netOverPlan), sell: usdCompact(h.sell.netOverPlan), hint: "proceeds less tax less exercise cost" },
  ];
  return (
    <section className="card">
      <h2>Hold or sell? {shares(h.shares)}{companyName ? ` ${companyName}` : ""} ISOs exercised in {h.year} <Info label="About this comparison">Exercise and hold a year for long-term treatment, or exercise and sell the same day. Everything else on the timeline stays as it is.</Info></h2>
      <div className="table-wrap">
        <div className="table-wrap"><table className="ledger compare">
          <thead><tr><th></th><th>Hold, sell in {h.hold.saleYear}</th><th>Sell the same day</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}><td>{r.label}{r.hint && <span className="muted"> · {r.hint}</span>}</td><td>{r.hold}</td><td>{r.sell}</td></tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <p className="muted small" style={{ margin: "10px 0 0" }}>
        {Math.abs(better) < 500
          ? "The two paths come out about even over the plan."
          : better > 0
            ? `Holding nets about ${usdCompact(better)} more over the plan, if the price holds to ${h.hold.saleYear}, but needs ${usdCompact(h.hold.cashNeeded)} of cash in ${h.year}.`
            : `Selling the same day nets about ${usdCompact(-better)} more over the plan and needs ${h.sell.cashNeeded <= 0 ? "no cash up front" : `${usdCompact(h.sell.cashNeeded)} of cash`}.`}
        {" "}The hold path assumes a sale at the end of {h.hold.saleYear}; move the exercise date or add your own sale on the timeline to test other timings.
      </p>
    </section>
  );
}
