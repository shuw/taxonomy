import { calibrate, type Profile } from "@taxonomy/engine";
import { fmtDelta, pct, usd } from "../format.ts";
import { usePersisted } from "../persist.ts";

/** How closely the engine reproduces the last filed return. */
export function CalibrationCard({ profile }: { profile: Profile }) {
  const [expanded, setExpanded] = usePersisted<boolean>("calibrationOpen", false, (v): v is boolean => typeof v === "boolean");
  const cal = calibrate(profile);
  if (!cal || cal.rows.length === 0) return null;
  const total = cal.rows.find((r) => r.id === "federalTotal") ?? cal.rows[cal.rows.length - 1]!;
  const rel = Math.abs(total.delta) / Math.max(1, Math.abs(total.reported));
  const tone = rel < 0.01 ? "good" : rel < 0.05 ? "" : "bad";
  const verdict = `${tone === "good" ? "Within" : "Off by"} ${pct(rel)} of the ${usd(total.reported)} you reported${tone === "good" ? "." : " (" + fmtDelta(total.delta) + ")."}`;
  return (
    <section className={"card calibration" + (expanded ? "" : " folded")}>
      <button type="button" className="card-fold" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        <h2>Your {cal.year} return, recomputed</h2>
        <svg className="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {!expanded && <div className="sub"><span className={"cal-inline " + tone}>{verdict}</span> A check that the math reproduces your filed return; open for the line-by-line comparison.</div>}
      {expanded && <>
      <div className="sub">The same math, run on the numbers from your filed return. Where it diverges is where a simplification matters for you.</div>
      <div className="cal-head">
        <div className="cal-big"><span className="label">{total.label}</span><span className="value">{usd(total.computed)}</span></div>
        <div className={"cal-verdict " + tone}>{verdict}</div>
      </div>
      <div className="table-wrap">
        <table className="ledger cal">
          <thead><tr><th></th><th>Reported</th><th>Computed</th><th>Difference</th></tr></thead>
          <tbody>
            {cal.rows.map((r) => (
              <tr key={r.id} className={r.id === total.id ? "total" : ""}>
                <td>{r.label}</td>
                <td>{usd(r.reported)}</td>
                <td>{usd(r.computed)}</td>
                <td className={Math.abs(r.delta) < 1 ? "muted" : ""}>{fmtDelta(r.delta) || "exact"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cal.missing.length > 0 && <div className="muted small" style={{ marginTop: 8 }}>Not on the return you provided: {cal.missing.join(", ")}.</div>}
      </>}
    </section>
  );
}
