import { calibrate, type Profile } from "@taxonomy/engine";
import { fmtDelta, pct, usd } from "../format.ts";

/** How closely the engine reproduces the last filed return. */
export function CalibrationCard({ profile }: { profile: Profile }) {
  const cal = calibrate(profile);
  if (!cal || cal.rows.length === 0) return null;
  const total = cal.rows.find((r) => r.id === "federalTotal") ?? cal.rows[cal.rows.length - 1]!;
  const rel = Math.abs(total.delta) / Math.max(1, Math.abs(total.reported));
  const tone = rel < 0.01 ? "good" : rel < 0.05 ? "" : "bad";
  return (
    <section className="card calibration">
      <h2>Your {cal.year} return, recomputed</h2>
      <div className="sub">The same math, run on the numbers from your filed return. Where it diverges is where a simplification matters for you.</div>
      <div className="cal-head">
        <div className="cal-big"><span className="label">{total.label}</span><span className="value">{usd(total.computed)}</span></div>
        <div className={"cal-verdict " + tone}>{tone === "good" ? "Within" : "Off by"} {pct(rel)} of the {usd(total.reported)} you reported{tone === "good" ? "." : " (" + fmtDelta(total.delta) + ")."}</div>
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
    </section>
  );
}
