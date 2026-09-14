import { fmvInYear, type AmtCrossover, type Levers, type Profile } from "@taxonomy/engine";
import { pct, shares, usd } from "../format.ts";

interface Props {
  profile: Profile;
  levers: Levers;
  crossovers: AmtCrossover[];
  focusYear: number;
  onFocus: (year: number) => void;
  onChange: (year: number, shares: number) => void;
}

export function LeverPanel({ profile, levers, crossovers, focusYear, onFocus, onChange }: Props) {
  const grant = profile.equity.isoGrants[0];
  return (
    <div>
      <h2>ISO shares exercised</h2>
      <div className="sub muted" style={{ fontSize: 12, marginBottom: 6 }}>
        {profile.equity.isoGrants.reduce((s, g) => s + g.shares, 0).toLocaleString()} shares across {profile.equity.isoGrants.length} grant{profile.equity.isoGrants.length === 1 ? "" : "s"}.
        The orange mark is where AMT starts.
      </div>
      {crossovers.map((c) => {
        const value = Math.min(levers.isoExercises[c.year] ?? 0, c.available);
        const markPct = c.available > 0 ? (c.sharesBeforeAmt / c.available) * 100 : 0;
        const spread = grant ? fmvInYear(profile, grant.fmv, c.year) - grant.strike : 0;
        return (
          <div className="lever" key={c.year}>
            <div className="head">
              <button className={"year" + (c.year === focusYear ? " focus" : "")} onClick={() => onFocus(c.year)}>{c.year}</button>
              <input type="number" min={0} max={c.available} step={100} value={value} onChange={(e) => onChange(c.year, Number(e.target.value))} />
            </div>
            <div className="track">
              <input type="range" min={0} max={c.available} step={c.available > 5000 ? 50 : 10} value={value} disabled={c.available === 0}
                onChange={(e) => onChange(c.year, Number(e.target.value))} onFocus={() => onFocus(c.year)} />
              {c.available > 0 && c.sharesBeforeAmt < c.available && <div className="mark" style={{ left: `calc(8px + (100% - 16px) * ${markPct / 100})` }} title={`AMT starts after ${shares(c.sharesBeforeAmt)} shares`} />}
            </div>
            <div className="foot">
              <span className={c.overCrossover ? "over" : ""}>
                {c.available === 0 ? "nothing left to exercise" : c.overCrossover ? `${shares(value - c.sharesBeforeAmt)} past the AMT line` : `AMT-free up to ${shares(c.sharesBeforeAmt)}`}
              </span>
              <span>{shares(c.available)} available · {usd(spread)}/sh</span>
            </div>
          </div>
        );
      })}
      <div className="assumptions">
        Assumptions (edit in the profile file)
        <dl>
          <dt>Share value growth</dt><dd>{pct(profile.assumptions.fmvGrowth)}/yr</dd>
          <dt>Wage growth</dt><dd>{pct(profile.assumptions.wageGrowth)}/yr</dd>
          <dt>Inflation indexing</dt><dd>{pct(profile.assumptions.inflation)}/yr</dd>
        </dl>
      </div>
    </div>
  );
}
