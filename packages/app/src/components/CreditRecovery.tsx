import type { CreditRecovery as Recovery } from "@taxonomy/engine";
import { shares, usdCompact } from "../format.ts";

/** How the credit from one year's ISO exercise comes back: a bar of recovered slices, then a sentence. */
export function CreditRecoveryView({ r, companyName }: { r: Recovery; companyName?: string }) {
  const total = r.generated;
  const slices = r.path.filter((p) => p.recovered > 0);
  const years = slices.map((p) => `${usdCompact(p.recovered)} in ${p.year}`);
  const sentence = slices.length === 0
    ? `None of it comes back within the plan${r.projectedYear ? "" : ": no year's regular tax is high enough to use it"}.`
    : r.leftover <= 0
      ? `It comes back ${years.join(", ")}; all of it by ${r.projectedYear}.`
      : `${years.join(", ")} come back; ${usdCompact(r.leftover)} is still waiting at the end of the plan${r.projectedYear ? `, likely back around ${r.projectedYear}` : ""}.`;
  return (
    <div className="recovery">
      <div className="recovery-head"><strong>{usdCompact(total)}</strong> of credit from exercising {shares(r.shares)}{companyName ? ` ${companyName}` : ""} ISOs in {r.year}</div>
      <div className="recovery-bar" role="img" aria-label="Credit recovery by year">
        {slices.map((p) => <span key={p.year} className="rec-slice" style={{ width: `${(p.recovered / total) * 100}%` }} title={`${usdCompact(p.recovered)} in ${p.year}`}><span>{p.year}</span></span>)}
        {r.leftover > 0 && <span className="rec-slice left" style={{ width: `${(r.leftover / total) * 100}%` }} title={`${usdCompact(r.leftover)} after the plan`}><span>later</span></span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>{sentence}</p>
    </div>
  );
}
