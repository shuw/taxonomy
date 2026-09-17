import { useEffect, useMemo } from "react";
import { fieldByPath, tools, type PendingIntake, type PendingRow, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { useContext } from "react";
import { ProfileIdContext } from "../persist.ts";
import { ago } from "../hooks/useAgentStatus.ts";
import { fmtDelta, pct, usd } from "../format.ts";
import { usePersisted } from "../persist.ts";
import { AgentSetup, clientName } from "./ConnectAgent.tsx";
import { PromptList } from "./ClaudePanel.tsx";
import { useAgentStatus } from "../hooks/useAgentStatus.ts";
import { parseIntake, reviewIntake } from "@taxonomy/engine";

interface Props { profile: Profile; edit: (edits: ProfileEdit[]) => void; onCompare: () => void; onReviewIntake: (doc: PendingIntake) => void; onCopyRequest: () => void; onEditFacts: () => void; onClaude: () => void; }

/** Set when a profile was created to be filled by a connected agent; cleared when something arrives or the user waves it off. */
export const AWAITING_KEY = (id: string) => `taxonomy.${id}.awaitingAgent`;

/** Scenarios an agent wrote to the file, offered against the active plan: accept, compare, discard, or keep for later. */
export function ProposalBanner({ profile, edit, onCompare, onReviewIntake, onCopyRequest, onEditFacts, onClaude }: Props) {
  const agent = useAgentStatus();
  const pending = useMemo(() => tools.pendingReview(profile), [profile]);
  const [awaiting, setAwaiting] = usePersisted<boolean>("awaitingAgent", false, (v): v is boolean => typeof v === "boolean");
  const docs = profile.pendingIntake ?? [];
  const summaries = useMemo(() => docs.map((d) => {
    const parsed = parseIntake(d.text);
    if (!parsed.doc) return { found: 0, questions: 0 };
    const r = reviewIntake(parsed.doc, profile);
    return { found: r.changes.filter((c) => c.status !== "same").length, questions: r.questions.length };
  }), [docs.map((d) => d.id + d.text).join("|"), profile]);
  const profileId = useContext(ProfileIdContext);
  const connectedHere = agent.lastSeen !== null && agent.conn?.lastProfile === profileId;
  const empty = !profile.people.self.salary && !(profile.returns?.length);
  const [nudgeOff, setNudgeOff] = usePersisted<boolean>("nudgeOff", false, (v): v is boolean => typeof v === "boolean");
  useEffect(() => { if ((docs.length || connectedHere) && awaiting) setAwaiting(false); }, [docs.length, connectedHere, awaiting]);
  const nudge = connectedHere && empty && !nudgeOff && docs.length === 0;
  if (pending.rows.length === 0 && docs.length === 0 && !awaiting && !nudge) return null;
  const resolve = (ids: string[] | undefined, accept: boolean) => edit(tools.resolvePending(profile, ids, accept));
  return (
    <>
      {docs.map((d, i) => (
        <section className="card proposal" key={d.id}>
          <div className="proposal-text">
            <div className="proposal-title">Claude sent {d.sections?.length ? d.sections.join(", ").replace("prior_return", "last return") : "your information"}</div>
            <div className="muted small">
              {summaries[i]?.found ? `${summaries[i]!.found} value${summaries[i]!.found === 1 ? "" : "s"} to look at` : "nothing new in it"}
              {summaries[i]?.questions ? ` · ${summaries[i]!.questions} to double-check` : ""} · {ago(new Date(d.submitted))}. Nothing is saved until you accept it.
            </div>
          </div>
          <div className="proposal-actions">
            <button type="button" className="btn primary" onClick={() => onReviewIntake(d)}>Review</button>
            <button type="button" className="btn" onClick={() => { const rest = docs.filter((x) => x.id !== d.id); edit([{ path: ["pendingIntake"], value: rest.length ? rest : undefined }]); }}>Discard</button>
          </div>
        </section>
      ))}
      {nudge && (
        <section className="card proposal claude">
          <div className="proposal-text">
            <div className="claude-line on"><span className="dot" />Connected · {clientName(agent.conn?.client)} · {ago(agent.lastSeen!)}</div>
            <div className="proposal-title">This profile is empty. Say one of these to Claude:</div>
            <PromptList profile={profile} compact />
            <div className="muted small">What Claude finds goes straight into the plan, with the source on each value; the Claude button in the top bar shows what came in. Or answer the questions below, or fill things in yourself.</div>
          </div>
          <div className="proposal-actions">
            <button type="button" className="btn primary" onClick={onClaude}>More to say</button>
            <button type="button" className="btn" onClick={onEditFacts}>Fill it in by hand</button>
            <button type="button" className="btn icon" title="Dismiss" aria-label="Dismiss" onClick={() => setNudgeOff(true)}>✕</button>
          </div>
        </section>
      )}
      {awaiting && docs.length === 0 && (
        <section className="card proposal">
          <div className="proposal-text">
            <div className="proposal-title">Connect Claude</div>
            <AgentSetup status={agent} name={profile.name?.trim() || "Me"} create expect={{ profile: profileId, since: 0 }} />
            <div className="proposal-links">
              <button type="button" className="link" onClick={onCopyRequest}>Copy a request instead</button>
              <button type="button" className="link" onClick={onEditFacts}>Fill it in by hand</button>
            </div>
          </div>
          <div className="proposal-actions">
            <button type="button" className="btn icon" title="Dismiss" aria-label="Dismiss" onClick={() => setAwaiting(false)}>✕</button>
          </div>
        </section>
      )}
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
      {docs.map((d, i) => (
        <section className="card proposal" key={d.id}>
          <div className="proposal-text">
            <div className="proposal-title">Claude sent {d.sections?.length ? d.sections.join(", ").replace("prior_return", "last return") : "your information"}</div>
            <div className="muted small">
              {summaries[i]?.found ? `${summaries[i]!.found} value${summaries[i]!.found === 1 ? "" : "s"} to look at` : "nothing new in it"}
              {summaries[i]?.questions ? ` · ${summaries[i]!.questions} to double-check` : ""} · {ago(new Date(d.submitted))}. Nothing is saved until you accept it.
            </div>
          </div>
          <div className="proposal-actions">
            <button type="button" className="btn primary" onClick={() => onReviewIntake(d)}>Review</button>
            <button type="button" className="btn" onClick={() => { const rest = docs.filter((x) => x.id !== d.id); edit([{ path: ["pendingIntake"], value: rest.length ? rest : undefined }]); }}>Discard</button>
          </div>
        </section>
      ))}
      {nudge && (
        <section className="card proposal claude">
          <div className="proposal-text">
            <div className="claude-line on"><span className="dot" />Connected · {clientName(agent.conn?.client)} · {ago(agent.lastSeen!)}</div>
            <div className="proposal-title">This profile is empty. Say one of these to Claude:</div>
            <PromptList profile={profile} compact />
            <div className="muted small">What Claude finds goes straight into the plan, with the source on each value; the Claude button in the top bar shows what came in. Or answer the questions below, or fill things in yourself.</div>
          </div>
          <div className="proposal-actions">
            <button type="button" className="btn primary" onClick={onClaude}>More to say</button>
            <button type="button" className="btn" onClick={onEditFacts}>Fill it in by hand</button>
            <button type="button" className="btn icon" title="Dismiss" aria-label="Dismiss" onClick={() => setNudgeOff(true)}>✕</button>
          </div>
        </section>
      )}
      {awaiting && docs.length === 0 && (
        <section className="card proposal">
          <div className="proposal-text">
            <div className="proposal-title">Connect Claude</div>
            <AgentSetup status={agent} name={profile.name?.trim() || "Me"} create expect={{ profile: profileId, since: 0 }} />
            <div className="proposal-links">
              <button type="button" className="link" onClick={onCopyRequest}>Copy a request instead</button>
              <button type="button" className="link" onClick={onEditFacts}>Fill it in by hand</button>
            </div>
          </div>
          <div className="proposal-actions">
            <button type="button" className="btn icon" title="Dismiss" aria-label="Dismiss" onClick={() => setAwaiting(false)}>✕</button>
          </div>
        </section>
      )}
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
    </>
  );
}

function Pill({ label, value, lowerIsGood }: { label: string; value: number; lowerIsGood: boolean }) {
  const text = fmtDelta(value);
  if (!text) return <span className="delta muted">{label} unchanged</span>;
  const good = lowerIsGood ? value < 0 : value > 0;
  return <span className={"delta " + (good ? "good" : "bad")}>{text} {label}</span>;
}


function fmtValue(row: PendingRow, v: unknown): string {
  const type = fieldByPath(row.field.replace(/^equity\.companies\.\d+\./, "equity.companies.0."))?.type;
  if (v === undefined || v === null || v === "") return type === "bool" ? "default" : "not set";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number") return type === "usd" ? usd(v) : type === "pct" ? pct(v) : v.toLocaleString("en-US");
  return String(v);
}
