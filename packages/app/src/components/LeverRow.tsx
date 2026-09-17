import { kindStyle } from "../series.ts";
import { LogRange, positionOf } from "./LogRange.tsx";
import { shares, usd } from "../format.ts";
import { NumberInput } from "./fields.tsx";

interface Props {
  label: string;
  hint: string;
  available: number;
  value: number;
  /** Share count where AMT starts, for the marker; null when there is none. */
  mark: number | null;
  over: boolean;
  sharesBeforeAmt: number;
  spread: number;
  onChange: (n: number) => void;
}

/** A shares slider with its number box, the AMT marker, and a footer explaining the range. */
export function LeverRow({ label, hint, available, value, mark, over, sharesBeforeAmt, spread, onChange }: Props) {
  const pctOf = (n: number) => positionOf(n, available) * 100;
  return (
    <div className="lever-row">
      <div className="head">
        <span className="badge" style={kindStyle(label.toLowerCase())}>{label}</span>
        <span className="lever-hint muted">{hint}</span>
        <NumberInput value={value} onChange={(n) => onChange(Math.min(available, n))} min={0} suffix="sh" />
      </div>
      <div className="track">
        <LogRange max={available} value={value} step={available > 5000 ? 50 : 10} onChange={onChange} />
        {mark !== null && <button type="button" className="mark" style={{ left: `calc(10px + (100% - 20px) * ${pctOf(mark) / 100})` }} title={`AMT starts after ${shares(mark)} shares; click to set exactly that`} aria-label={`Set to ${shares(mark)} shares, the AMT line`} onClick={() => onChange(mark)} />}
      </div>
      <div className="foot">
        <span className={over ? "over" : ""}>
          {available === 0 ? "nothing exercisable this year" : mark === null ? "" : over ? `${shares(value - sharesBeforeAmt)} past the AMT line` : `AMT-free up to ${shares(sharesBeforeAmt)}`}
        </span>
        <span>{shares(available)} exercisable · {usd(spread)}/sh spread</span>
      </div>
    </div>
  );
}
