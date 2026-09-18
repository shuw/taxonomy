import { demoText } from "../format.ts";
import { zeroAside } from "../whimsy.ts";
import type { PlanResult } from "@taxonomy/engine";
import { fmtDelta, fmtLine } from "../format.ts";
import type { Selection } from "../App.tsx";

interface Props { plan: PlanResult; pinned: PlanResult | null; selection: Selection; onSelect: (s: Selection) => void; onClose: () => void; }

export function ExplainPanel({ plan, pinned, selection, onSelect, onClose }: Props) {
  const year = plan.years.find((y) => y.year === selection.year);
  const line = year?.lines[selection.id];
  if (!year || !line) return <div className="muted">Nothing selected.</div>;
  const deps = line.deps.map((d) => year.lines[d]).filter((l) => l !== undefined);
  const usedBy = year.order.map((id) => year.lines[id]!).filter((l) => l.deps.includes(line.id));
  const pinnedLine = pinned?.years.find((y) => y.year === selection.year)?.lines[line.id];
  const prev = plan.years.find((y) => y.year === selection.year - 1)?.lines[line.id];
  return (
    <div>
      <button className="btn close" onClick={onClose} aria-label="Close">×</button>
      <div className="year">{selection.year}</div>
      <h3>{line.label}</h3>
      <div className="value">{fmtLine(line)}</div>
      {pinnedLine && <div className="pinned">Pinned scenario: {fmtLine(pinnedLine)} ({fmtDelta(line.value - pinnedLine.value, line.unit) || "same"})</div>}
      <div className="why">{demoText(line.why)}{(() => { const a = zeroAside(line.id, selection.year, line.value); return a ? <span className="aside"> {a}</span> : null; })()}</div>
      {deps.length > 0 && (
        <>
          <h4>Computed from</h4>
          <ul>{deps.map((d) => <li key={d.id}><button onClick={() => onSelect({ year: selection.year, id: d.id })}><span>{d.label}</span><span className="mono">{fmtLine(d)}</span></button></li>)}</ul>
        </>
      )}
      {usedBy.length > 0 && (
        <>
          <h4>Feeds into</h4>
          <ul>{usedBy.map((d) => <li key={d.id}><button onClick={() => onSelect({ year: selection.year, id: d.id })}><span>{d.label}</span><span className="mono">{fmtLine(d)}</span></button></li>)}</ul>
        </>
      )}
      {prev && (
        <>
          <h4>Same line, other years</h4>
          <ul>{plan.years.map((y) => <li key={y.year}><button onClick={() => onSelect({ year: y.year, id: line.id })}><span>{y.year}</span><span className="mono">{fmtLine(y.lines[line.id]!)}</span></button></li>)}</ul>
        </>
      )}
    </div>
  );
}
