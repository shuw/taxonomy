import { useContext, useEffect, useState } from "react";
import type { Profile } from "@taxonomy/engine";
import { ProfileIdContext } from "../persist.ts";
import { ago, useAgentStatus, type AgentStatus } from "../hooks/useAgentStatus.ts";
import type { HistoryRow } from "../api.ts";
import { AgentSetup, clientName, ManualSetup } from "./ConnectAgent.tsx";

/** Prompts that fit where this profile is: the empty parts first, then what the plan can answer. */
export function suggestedPrompts(profile: Profile): { text: string; why: string }[] {
  const out: { text: string; why: string }[] = [];
  const name = profile.name?.trim() || "Me";
  if (!(profile.returns?.length)) out.push({ text: "Read my last tax return and fill in what you find.", why: "Calibrates the model against a filed year." });
  if (!profile.people.self.salary) out.push({ text: "My base salary is 250,000 and my bonus target is 30,000.", why: "Simple facts go straight in, for your review." });
  out.push({ text: `${profile.equity.grants.length ? "Update" : "Set up"} my equity from these documents: grant notices, the holdings page from my portal, and any exercise confirmations.`, why: "Grants, vesting schedules and the shares you already own, for your review." });
  if (profile.equity.grants.some((g) => g.type === "iso")) out.push({ text: "What's the most I can exercise this year without paying AMT?", why: "Answered from the plan, with the reason." });
  if (profile.equity.grants.length > 0) out.push({ text: "Exercise 2,000 shares next year and sell half the year after. What does that do?", why: "Arrives as a scenario for you to accept." });
  out.push({ text: `Why is ${profile.plan.startYear + 1} different from ${profile.plan.startYear}?`, why: "Line by line, from the ledger." });
  out.push({ text: "Assume 20% share growth from now on.", why: "An assumption change, waiting for your yes." });
  if (out.length < 4) out.push({ text: `Connect to my Taxonomy profile "${name}" and tell me what's still missing.`, why: "A quick status from Claude's side." });
  return out.slice(0, 6);
}

export function PromptList({ profile, compact }: { profile: Profile; compact?: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setCopied(t); setTimeout(() => setCopied(null), 1500); } catch { /* selectable */ } };
  const list = suggestedPrompts(profile).slice(0, compact ? 3 : 5);
  return (
    <ul className={"prompts" + (compact ? " compact" : "")}>
      {list.map((p) => (
        <li key={p.text}>
          <button type="button" className="prompt" onClick={() => void copy(p.text)} title="Copy">
            <q>{p.text}</q>
            {!compact && <span className="muted small">{p.why}</span>}
          </button>
          <span className="prompt-copied">{copied === p.text ? "Copied" : ""}</span>
        </li>
      ))}
    </ul>
  );
}

/** The green dot in the top bar: who is connected and when, or an invitation to connect. */
export function ClaudeStatusButton({ status, news, onClick }: { status: AgentStatus; news: number; onClick: () => void }) {
  const on = status.lastSeen !== null;
  return (
    <button type="button" className={"btn claude-status" + (on ? " on" : "") + (news ? " has-news" : "")} onClick={onClick} title={news ? `${news} new change${news === 1 ? "" : "s"} from Claude` : on ? `Connected · last used ${ago(status.lastSeen!)}` : "Connect Claude"}>
      <span className="dot" />
      {on ? clientName(status.conn?.client) : "Connect Claude"}
      {news > 0 && <span className="badge-new">{news}</span>}
    </button>
  );
}

/** The Claude panel: connection state, what to say next, and the setup when it is not connected yet. */
export function ClaudePanel({ profile, news, onSeen, onHistory, onClose }: { profile: Profile; news: HistoryRow[]; onSeen: () => void; onHistory: () => void; onClose: () => void }) {
  const status = useAgentStatus();
  const id = useContext(ProfileIdContext);
  const on = status.lastSeen !== null;
  const here = on && status.conn?.lastProfile === id;
  const [showSetup, setShowSetup] = useState(false);
  // What arrived is shown once, then counted as seen.
  const [fresh] = useState(news);
  useEffect(() => { onSeen(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const openLink = status.conn?.client === "claude.ai" || !on ? <a className="btn" href="https://claude.ai/new" target="_blank" rel="noreferrer">Open claude.ai</a>
    : <button type="button" className="btn" onClick={() => void status.openDesktop()}>Open Claude Desktop</button>;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal claude-panel" role="dialog" aria-modal="true" aria-label="Claude">
        <div className="modal-head">
          <div>
            <h3>Claude</h3>
            <div className={"claude-line" + (on ? " on" : "")}>
              <span className="dot" />
              {on ? <>Connected · {clientName(status.conn?.client)} · {ago(status.lastSeen!)}{!here && status.conn?.lastProfile ? <span className="muted"> · last about “{status.conn.lastProfile}”</span> : null}</> : "Not connected yet"}
            </div>
          </div>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {on && !showSetup ? (
            <>
              {fresh.length > 0 && (
                <div className="news">
                  <div className="subhead">New from Claude</div>
                  <ul className="plain">
                    {fresh.slice(0, 8).map((r) => <li key={r.at}><span className="muted small">{ago(new Date(r.at))} · </span>{r.lines.join("; ")}</li>)}
                  </ul>
                  <button type="button" className="link" onClick={onHistory}>Full history, with undo</button>
                </div>
              )}
              <div className="subhead">Things to say</div>
              <p className="muted small" style={{ margin: 0 }}>Click one to copy it. What Claude changes shows up here and in the plan at once; every change is in the history and can be undone.</p>
              <PromptList profile={profile} />
              <div className="modal-actions">
                {openLink}
                <span className="spacer" />
                <button type="button" className="link" onClick={() => setShowSetup(true)}>Connection settings</button>
              </div>
              <div className="subhead">What Claude can do here</div>
              <ul className="plain">
                <li><b>Answer</b> from the plan: any number, with the ledger's reason behind it.</li>
                <li><b>Try</b> decisions and save them as scenarios the plan switches to.</li>
                <li><b>Fill in</b> facts you tell it and documents it reads, with the source recorded on each value.</li>
                <li><b>Never</b> compute tax itself. Every change it makes is logged, and any of them can be undone from History.</li>
              </ul>
            </>
          ) : (
            <>
              {on && <button type="button" className="link" onClick={() => setShowSetup(false)}>← Back to things to say</button>}
              <AgentSetup status={status} name={profile.name?.trim() || "Me"} create={false} />
              <details className="sections-details"><summary>Set up Claude Desktop by hand</summary><ManualSetup conn={status.conn} /></details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
