import type { ScenarioEvent } from "@taxonomy/engine";
import { MoneyInput, Select } from "../fields.tsx";
import { InspectorShell, YearSelect } from "./InspectorShell.tsx";

type GiveEvent = Extract<ScenarioEvent, { kind: "give" }>;

export const giveHow = (how: GiveEvent["how"]) => (how === "stock" ? "shares" : how === "daf" ? "donor-advised fund" : "cash");

const HOW = [{ value: "cash", label: "cash" }, { value: "stock", label: "appreciated shares" }, { value: "daf", label: "to a donor-advised fund" }];

/** A gift in the scenario: how, how much, and what it does to tax and cash. */
export function GiveInspector({ years, event: e, onChange, onRemove }: { years: number[]; event: GiveEvent; onChange: (patch: Partial<ScenarioEvent>) => void; onRemove: () => void }) {
  return (
    <InspectorShell kind="give" title="Give" onRemove={onRemove}
      head={<>
        <span className="ei-how"><Select options={HOW} value={e.how} onChange={(v) => onChange({ how: v as GiveEvent["how"] })} /></span>
        <span className="muted">in</span>
        <YearSelect years={years} value={e.year} onChange={(y) => onChange({ year: y })} />
        <span className="muted">of</span>
        <span className="ei-value"><MoneyInput value={e.amount} onChange={(n) => onChange({ amount: Math.max(0, n) })} /></span>
      </>}>
      <p className="muted small" style={{ margin: 0 }}>On top of the yearly giving under Edit my information.{e.how === "stock" ? " Shares are not cash, so the chart shows them above the bar." : ""}</p>
    </InspectorShell>
  );
}
