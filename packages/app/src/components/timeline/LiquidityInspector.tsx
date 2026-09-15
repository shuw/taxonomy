import { companyPrice, type PlanResult, type Profile, type ScenarioEvent } from "@taxonomy/engine";
import { shares, usd, usdCompact } from "../../format.ts";
import { MoneyInput, Select } from "../fields.tsx";
import { InspectorShell, YearSelect } from "./InspectorShell.tsx";

type LiquidityEvent = Extract<ScenarioEvent, { kind: "liquidity" }>;

interface Props { profile: Profile; plan: PlanResult; years: number[]; event: LiquidityEvent; onChange: (patch: Partial<ScenarioEvent>) => void; onRemove: () => void; }

export function LiquidityInspector({ profile, plan, years, event: e, onChange, onRemove }: Props) {
  const companies = profile.equity.companies;
  const c = companies.find((x) => x.id === e.company) ?? companies[0];
  const modeled = companyPrice(profile, c, e.year);
  const yr = plan.years.find((y) => y.year === e.year);
  const doubleTrigger = profile.equity.grants.some((g) => g.type === "rsu" && g.settlement === "liquidity" && (g.company ?? companies[0]?.id) === c?.id);
  return (
    <InspectorShell kind="liquidity" title="Liquidity event" onRemove={onRemove}
      head={<>
        <span className="muted">in</span>
        <YearSelect years={years} value={e.year} onChange={(y) => onChange({ year: y })} />
        {companies.length > 1 && <span className="ei-year"><Select options={companies.map((x) => ({ value: x.id, label: x.name }))} value={c?.id ?? ""} onChange={(id) => onChange({ company: id })} /></span>}
      </>}>
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
    </InspectorShell>
  );
}
