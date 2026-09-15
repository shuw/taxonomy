import { useMemo } from "react";
import { fieldByPath, tools, type PendingRow, type Profile, type ProfileEdit, type ScenarioEvent } from "@taxonomy/engine";
import { fmtDelta, pct, usd } from "../format.ts";
import { usePersisted } from "../persist.ts";

interface Props { profile: Profile; edit: (edits: ProfileEdit[]) => void; onCompare: () => void; }

/** Scenarios an agent wrote to the file, offered against the active plan: accept, compare, discard, or keep for later. */
export function ProposalBanner({ profile, edit, onCompare }: Props) {
  const all = useMemo(() => tools.proposals(profile), [profile]);
  const [later, setLater] = usePersisted<string[]>("proposalsLater", [], (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string"));
  const shown = all.filter((p) => !later.includes(p.name));
  const pending = useMemo(() => tools.pendingReview(profile), [profile]);
  if (shown.length === 0 && pending.rows.length === 0) return null;
  const activate = (name: string) => { setLater((l) => [...l, name]); edit([{ path: ["activeScenario"], value: name }]); };
  const resolve = (ids: string[] | undefined, accept: boolean) => edit(tools.resolvePending(profile, ids, accept));
  return (
    <>
      {pending.rows.length > 0 && (
        <section className="card proposal">
          <div className="proposal-text">
            <div className="proposal-title">Your agent wants to change {pending.rows.length === 1 ? "one thing" : `${pending.rows.length} things`} in your information</div>
            <table className="pending-rows">
              <tbody>
                {pending.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="pending-label">{r.label}{r.from ? <span className="muted"> from {r.from}</span> : null}</td>
                    <td className="muted">{fmtValue(r, r.current)}</td>
                    <td className="pending-arrow" aria-hidden="true">→</td>
                    <td><b>{fmtValue(r, r.proposed)}</b></td>
                    <td className="muted small">{r.source}</td>
                    <td className="pending-actions">
                      <button type="button" className="btn icon" title="Accept this one" onClick={() => resolve([r.id], true)}>✓</button>
                      <button type="button" className="btn icon" title="Discard this one" onClick={() => resolve([r.id], false)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pending.delta && (
              <div className="proposal-deltas">
                <Pill label="total tax" value={pending.delta.totalTax} lowerIsGood />
                <Pill label="net cash" value={pending.delta.netCash} lowerIsGood={false} />
              </div>
            )}
          </div>
          <div className="proposal-actions">
            <button type="button" className="btn primary" onClick={() => resolve(undefined, true)}>Accept all</button>
            <button type="button" className="btn" onClick={() => resolve(undefined, false)}>Discard all</button>
          </div>
        </section>
      )}
      {shown.map((p) => (
        <section className="card proposal" key={p.name}>
          <div className="proposal-text">
            <div className="proposal-title">Your agent proposed <b>“{p.name}”</b></div>
            <div className="muted small">{p.note}{p.events.length ? ` · ${p.events.map((e) => describe(profile, e)).join(", ")}` : " · no new decisions"}</div>
            <div className="proposal-deltas">
              <Pill label="total tax" value={p.delta.totalTax} lowerIsGood />
              <Pill label="net cash" value={p.delta.netCash} lowerIsGood={false} />
              {p.delta.byYear.some((d) => d.amt !== 0) && <Pill label="AMT" value={p.delta.byYear.reduce((s, d) => s + d.amt, 0)} lowerIsGood />}
            </div>
          </div>
          <div className="proposal-actions">
            <button type="button" className="btn primary" onClick={() => activate(p.name)}>Accept</button>
            <button type="button" className="btn" title="Pin the current plan, then switch to the proposal" onClick={() => { onCompare(); activate(p.name); }}>Compare</button>
            <button type="button" className="btn" onClick={() => edit([{ path: ["scenarios", p.name], value: undefined }])}>Discard</button>
            <button type="button" className="btn icon" title="Keep the scenario, hide this" aria-label="Later" onClick={() => setLater((l) => [...l, p.name])}>✕</button>
          </div>
        </section>
      ))}
    </>
  );
}

function Pill({ label, value, lowerIsGood }: { label: string; value: number; lowerIsGood: boolean }) {
  const text = fmtDelta(value);
  if (!text) return <span className="delta muted">{label} unchanged</span>;
  const good = lowerIsGood ? value < 0 : value > 0;
  return <span className={"delta " + (good ? "good" : "bad")}>{text} {label}</span>;
}

function describe(profile: Profile, e: ScenarioEvent): string {
  const n = (x: number) => x.toLocaleString("en-US");
  if (e.kind === "exercise") return `exercise ${n(e.shares)} ${e.type.toUpperCase()}s in ${e.year}`;
  if (e.kind === "sell") return `sell ${n(e.shares)} in ${e.year}`;
  return `${profile.equity.companies.length > 1 && e.company ? `${e.company} ` : ""}liquidity in ${e.year}`;
}

function fmtValue(row: PendingRow, v: unknown): string {
  const type = fieldByPath(row.field.replace(/^equity\.companies\.\d+\./, "equity.companies.0."))?.type;
  if (v === undefined || v === null || v === "") return type === "bool" ? "default" : "not set";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number") return type === "usd" ? usd(v) : type === "pct" ? pct(v) : v.toLocaleString("en-US");
  return String(v);
}
