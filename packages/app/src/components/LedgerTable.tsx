import type { PlanResult } from "@taxonomy/engine";
import { fmtDelta, fmtLine } from "../format.ts";
import type { Selection } from "../App.tsx";

const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Income", ids: ["salarySelf", "salarySpouse", "rsuIncome", "nsoIncome", "pretaxContributions", "wages", "netLongTermGain", "capitalLossDeduction", "agi"] },
  { title: "Deductions", ids: ["saltDeduction", "mortgageInterest", "charitableDeduction", "deduction", "taxableIncome"] },
  { title: "Regular tax", ids: ["ordinaryTax", "capGainsTax", "regularTax", "marginalBracket"] },
  { title: "AMT", ids: ["isoSharesExercised", "isoBargainElement", "amti", "amtExemption", "tentativeMinimumTax", "amt"] },
  { title: "AMT credit", ids: ["amtCreditGenerated", "amtCreditUsed", "amtCreditCarryforwardOut"] },
  { title: "Other", ids: ["niit", "additionalMedicare", "stateCapitalGainsTax", "stateMillionairesTax", "stateRegularTax", "stateAmt", "stateTax"] },
];
const TOTALS = ["federalTotal", "totalTax", "effectiveRate"];

interface Props { plan: PlanResult; pinned: PlanResult | null; focusYear: number; selected: Selection | null; onSelect: (s: Selection) => void; }

export function LedgerTable({ plan, pinned, focusYear, selected, onSelect }: Props) {
  const years = plan.years;
  const row = (id: string, total = false) => {
    if (!years.every((y) => y.lines[id])) return null;
    const label = years[0]!.lines[id]?.label ?? id;
    return (
      <tr key={id} className={total ? "total" : ""}>
        <td>{label}</td>
        {years.map((y) => {
          const line = y.lines[id]!;
          const pinnedLine = pinned?.years.find((p) => p.year === y.year)?.lines[id];
          const delta = pinnedLine ? fmtDelta(line.value - pinnedLine.value, line.unit) : "";
          const isSel = selected?.year === y.year && selected.id === id;
          return (
            <td key={y.year} className={"num" + (y.year === focusYear ? " focus" : "") + (isSel ? " selected" : "")} onClick={() => onSelect({ year: y.year, id })} title="Why?">
              {fmtLine(line)}
              {pinned && <span className="delta">{delta || " "}</span>}
            </td>
          );
        })}
      </tr>
    );
  };
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead>
          <tr><th></th>{years.map((y) => <th key={y.year} className={y.year === focusYear ? "focus" : ""}>{y.year}</th>)}</tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => [
            <tr key={g.title} className="group"><td colSpan={years.length + 1}>{g.title}</td></tr>,
            ...g.ids.map((id) => row(id)),
          ])}
          {TOTALS.map((id) => row(id, true))}
        </tbody>
      </table>
    </div>
  );
}
