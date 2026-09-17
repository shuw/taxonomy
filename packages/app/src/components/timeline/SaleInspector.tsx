import { kindStyle } from "../../series.ts";
import { LogRange } from "../LogRange.tsx";
import { isLongTerm, isQualifying, longTermFrom, lotMilestones, lotPrice, qualifyingFrom, type Lot, type PlanResult, type Profile, type SaleResult, type ScenarioEvent } from "@taxonomy/engine";
import { fmtDelta, shares, usd, usdCompact } from "../../format.ts";
import { MoneyInput, NumberInput } from "../fields.tsx";
import { DateField, InspectorShell, YearSelect } from "./InspectorShell.tsx";

type SellEvent = Extract<ScenarioEvent, { kind: "sell" }>;

interface Props { profile: Profile; plan: PlanResult; years: number[]; event: SellEvent; result: SaleResult | undefined; onChange: (patch: Partial<ScenarioEvent>) => void; onRemove: () => void; onSellToCover: () => void; }

export function SaleInspector({ profile, plan, years, event: e, result, onChange, onRemove, onSellToCover }: Props) {
  const yr = plan.years.find((y) => y.year === e.year);
  const lots: Lot[] = yr?.lotsBefore ?? [];
  const held = lots.reduce((s, l) => s + l.quantity, 0);
  const date = e.date ?? `${e.year}-12-31`;
  const explicit = !!e.lots;
  const sold = result?.shares ?? 0;
  const modeled = lots[0] ? lotPrice(profile, lots[0], e.year) : 0;
  const price = e.price ?? modeled;
  const want = Math.min(e.shares, held);
  const milestones = lotMilestones(lots, date).filter((m) => m.date <= `${e.year + 1}-12-31`).slice(0, 3);
  const tax = yr ? yr.lines.totalTax!.value : 0;
  const pickMyself = () => onChange({ lots: Object.fromEntries((result?.lots ?? []).map((l) => [l.lotId, l.shares])) });
  const setLot = (id: string, n: number) => onChange({ lots: { ...(e.lots ?? {}), [id]: Math.max(0, Math.round(n)) } });

  return (
    <InspectorShell kind="sale" title="Sell shares" onRemove={onRemove}
      head={<>
        <span className="muted">on</span>
        <DateField value={e.date} fallback={`${e.year}-12-31`} onChange={(d) => onChange({ date: d, ...(d ? { year: Number(d.slice(0, 4)) } : {}) })} />
        <YearSelect years={years} value={e.year} onChange={(y) => onChange({ year: y, date: undefined })} />
      </>}>
      {held === 0 ? (
        <p className="muted small">Nothing to sell in {e.year}: no shares are held by then. Exercise options or wait for RSUs to settle first.</p>
      ) : (
        <>
          <div className="lever-row">
            <div className="head">
              <span className="badge" style={kindStyle("sell")}>SELL</span>
              <span className="lever-hint muted">{explicit ? `lots picked by hand · ${shares(sold)} of ${shares(held)} held at ${usd(price)}/sh` : "lowest-tax lots first"}</span>
              {!explicit && <NumberInput value={want} onChange={(n) => onChange({ shares: Math.max(0, Math.min(held, Math.round(n))) })} min={0} suffix="sh" />}
            </div>
            {!explicit && (
              <>
                <div className="track">
                  <LogRange max={held} value={want} step={held > 5000 ? 50 : 10} onChange={(n) => onChange({ shares: n })} />
                </div>
                <div className="foot">
                  <span>{shares(sold)} of {shares(held)} held</span>
                  <span>at {usd(price)}/sh{e.price !== undefined ? " (yours)" : ` (modeled ${e.year} price)`}</span>
                </div>
              </>
            )}
          </div>
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
    </InspectorShell>
  );
}
