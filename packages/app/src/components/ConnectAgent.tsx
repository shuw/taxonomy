import { useEffect, useState, type ReactNode } from "react";
import type { AgentConnection } from "../api.ts";
import { ago, useAgentStatus, type AgentStatus } from "../hooks/useAgentStatus.ts";

/** The sentence to say to a connected agent: connecting is the handshake; filling in happens in conversation after it. */
export const agentSentence = (name: string, create: boolean) => (create ? `Connect to my Taxonomy profile "${name}"` : `Update my Taxonomy profile "${name}" from my documents`);

/** claude.ai's deep link to the add-connector dialog. It does not take the name or address, so those are copied. */
const CONNECTOR_LINK = "https://claude.ai/new?modal=add-custom-connector#customize/connectors";

/** MCP clients announce a machine name; show the one people know. */
export function clientName(raw: string | null | undefined): string {
  if (!raw) return "Claude";
  const k = raw.toLowerCase();
  if (k === "claude.ai") return "claude.ai";
  if (k.includes("claude-desktop") || k === "claude-ai" || k.includes("claude desktop")) return "Claude Desktop";
  if (k.includes("claude-code") || k.includes("claude code")) return "Claude Code";
  return raw;
}

export type AgentClient = "desktop" | "web" | "code";
const CLIENT_KEY = "taxonomy.agentClient";
const CLIENTS: { value: AgentClient; label: string }[] = [{ value: "desktop", label: "Claude Desktop" }, { value: "web", label: "claude.ai" }, { value: "code", label: "Claude Code" }];
function readClient(): AgentClient {
  try { const v = localStorage.getItem(CLIENT_KEY); if (v === "desktop" || v === "web" || v === "code") return v; } catch {}
  return "desktop";
}

interface SetupProps {
  status: AgentStatus;
  /** Profile name, for the sentence to say. */
  name: string;
  /** New profile: the sentence says "fill in"; otherwise "update". */
  create: boolean;
  /** Rendered as its own step between adding and saying, for the create dialog's button. */
  between?: ReactNode;
  /** The handshake to wait for: a call about this profile id after this time. */
  expect?: { profile: string; since: number };
  /** Called once when the expected handshake lands. */
  onConnected?: () => void;
}

/**
 * The whole setup as a checklist, each step done with one click and showing its state:
 * add Taxonomy to Claude Desktop, open it and say the sentence, watch the numbers arrive.
 */
export function AgentSetup({ status, name, create, between, expect, onConnected }: SetupProps) {
  const d = status.conn?.desktop;
  const r = status.conn?.remote;
  const [client, setClientState] = useState<AgentClient>(readClient);
  // Typed here, saved on the server next to the secret; the saved one is the default everywhere.
  const [typedHost, setTypedHost] = useState<string | null>(null);
  const tunnelHost = typedHost ?? status.conn?.remote?.tunnelHost ?? "";
  const setTunnelHost = (raw: string) => { const host = raw.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""); setTypedHost(host); void status.setTunnelHost(host); };
  const setClient = (c: AgentClient) => { setClientState(c); try { localStorage.setItem(CLIENT_KEY, c); } catch {} };
  const sentence = agentSentence(name, create);
  const [copied, setCopied] = useState<string | null>(null);
  const [opened, setOpened] = useState<boolean | null>(null);
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 1500); } catch { /* selectable */ } };
  const open = async () => { setOpened(await status.openDesktop()); setTimeout(() => setOpened(null), 4000); };
  const seenAt = status.lastSeen?.getTime() ?? 0;
  const fresh = expect ? seenAt > expect.since : status.lastSeen !== null;
  const forThis = !expect || status.conn?.lastProfile === expect.profile;
  const connected = fresh && forThis;
  const elsewhere = fresh && !forThis ? status.conn?.lastProfile : null;
  useEffect(() => { if (connected && onConnected) onConnected(); }, [connected]);
  const pick = <div className="segmented small">{CLIENTS.map((c) => <button key={c.value} type="button" role="radio" aria-checked={client === c.value} className={client === c.value ? "on" : ""} onClick={() => setClient(c.value)}>{c.label}</button>)}</div>;
  const say = (where: string, extra?: ReactNode) => (
    <>
      <div className="say"><q>{sentence}</q></div>
      <div className="step-actions">
        <button type="button" className="btn" onClick={() => void copy("say", sentence)}>{copied === "say" ? "Copied" : "Copy"}</button>
        {extra}
      </div>
    </>
  );
  const arrival = (n: number) => (
    <Step n={n} done={connected} title={connected ? `Connected · ${clientName(status.conn?.client)} · ${ago(status.lastSeen!)}` : expect ? "Claude connects" : "Its changes appear in the plan"}>
      {!connected && !elsewhere && <span className="agent-status"><span className="dot pulse" /> {expect ? "Waiting for Claude to connect…" : "Waiting for the first call."}</span>}
      {elsewhere && <span className="muted small">Claude connected to “{elsewhere}” instead. Say the sentence again; if two profiles share a name, delete the spare first.</span>}
    </Step>
  );
  let n = 0;

  // Choosing claude.ai starts the local HTTP server; nothing to press.
  useEffect(() => { if (client === "web" && status.conn?.remote && !status.conn.remote.running && !status.busy) void status.serve(true); }, [client, status.conn?.remote?.running]);

  if (client === "web") {
    // Local testing: the tunnel step. A hosted deployment reports its own address in `remote.url`
    // and this step is skipped, so the same checklist serves both.
    const url = r?.url ?? (r?.running && tunnelHost ? `https://${tunnelHost}${r.path}` : null);
    const shared = !!url;
    const ngrok = `ngrok http ${r?.port ?? 5182}`;
    return (
      <ol className="setup">
        <Step n={++n} done={!!r?.running} title={r?.running ? "Local server running" : "Starting the local server…"}>
          {pick}
          <span className="muted small">Local only; the tunnel forwards to it.</span>
          {status.error && <div className="error">{status.error}</div>}
        </Step>
        {!r?.url && (
          <Step n={++n} done={shared} title={shared ? "Reachable from claude.ai" : "Open a tunnel to it"}>
            {!shared && (
              <>
                <span className="muted small">claude.ai needs a public address. In a terminal, with a free <a href="https://dashboard.ngrok.com/signup" target="_blank" rel="noreferrer">ngrok</a> account (<code>ngrok config add-authtoken …</code> once), run and leave running:</span>
                <div className="say"><code>{ngrok}</code><button type="button" className="btn" onClick={() => void copy("ngrok", ngrok)}>{copied === "ngrok" ? "Copied" : "Copy"}</button></div>
                <span className="muted small">Paste the https address it prints under “Forwarding”:</span>
                <span className="input-wrap"><input placeholder="https://your-name.ngrok-free.dev" value={tunnelHost} onChange={(e) => setTunnelHost(e.target.value)} /></span>
                <details className="sections-details">
                  <summary>Other tunnels</summary>
                  <span className="muted small">
                    A fixed ngrok domain (free, under Domains in its dashboard) keeps the address the same: <code>ngrok http --url=your-name.ngrok-free.app {r?.port ?? 5182}</code>.
                    Cloudflare needs no account: <code>cloudflared tunnel --url http://127.0.0.1:{r?.port ?? 5182}</code>, new address each run.
                    {r?.tunnel.available && <> Tailscale Funnel, if your tailnet allows it: <code>{r.funnelCommand}</code>; this page notices on its own.</>}
                  </span>
                </details>
              </>
            )}
            {shared && tunnelHost && <span className="muted small">Through <code>{tunnelHost}</code>. Only this exact address works.</span>}
          </Step>
        )}
        <Step n={++n} done={connected} title="Add it in claude.ai">
          <div className="step-actions">
            <a className={"btn" + (shared ? " primary" : "")} href={CONNECTOR_LINK} target="_blank" rel="noreferrer">Open the dialog in claude.ai</a>
            <span className="muted small">Two fields; copy each from here. Leave authentication empty.</span>
          </div>
          <div className="say"><span className="muted small">Name</span><code>Taxonomy</code><button type="button" className="btn" onClick={() => void copy("name", "Taxonomy")}>{copied === "name" ? "Copied" : "Copy"}</button></div>
          {shared
            ? <div className="say"><span className="muted small">MCP server URL</span><code className="url">{url}</code><button type="button" className="btn" onClick={() => void copy("url", url!)}>{copied === "url" ? "Copied" : "Copy"}</button></div>
            : <span className="muted small">The address appears here once the tunnel is up.</span>}
        </Step>
        {between && <Step n={++n} title="Create the profile">{between}</Step>}
        <Step n={++n} done={connected} title="Open claude.ai and say">{say("web", <a className="btn" href="https://claude.ai/new" target="_blank" rel="noreferrer">Open claude.ai</a>)}</Step>
        {arrival(++n)}
      </ol>
    );
  }

  if (client === "code") {
    return (
      <ol className="setup">
        <Step n={++n} done title="Claude Code finds Taxonomy on its own">
          {pick}
          <span className="muted small">Open Claude Code in this folder; the repository's <code>.mcp.json</code> registers the server. Elsewhere: <code>claude mcp add taxonomy -- {status.conn?.command ?? "bun"} {status.conn?.script ?? "packages/mcp/server.ts"}</code></span>
        </Step>
        {between && <Step n={++n} title="Create the profile">{between}</Step>}
        <Step n={++n} done={connected} title="In Claude Code, say">{say("code")}</Step>
        {arrival(++n)}
      </ol>
    );
  }

  return (
    <ol className="setup">
      <Step n={++n} done={connected || !!d?.added} title={d?.added ? (connected ? "Taxonomy is in Claude Desktop" : "Added to Claude Desktop. Restart it once.") : "Add Taxonomy to Claude Desktop"}>
        {pick}
        {!d?.added && (
          <div className="step-actions">
            {d?.installed === false
              ? <a className="btn" href="https://claude.ai/download" target="_blank" rel="noreferrer">Get Claude Desktop</a>
              : <button type="button" className="btn primary" onClick={() => void status.addToDesktop()} disabled={!status.conn}>Add to Claude Desktop</button>}
          </div>
        )}
        {status.error && <div className="error">{status.error}</div>}
      </Step>
      {between && <Step n={++n} title="Create the profile">{between}</Step>}
      <Step n={++n} done={connected} title="Open Claude Desktop and say">
        {say("desktop", d?.installed !== false && <button type="button" className="btn" onClick={() => void open()}>{opened === false ? "Couldn't open it" : opened ? "Opening…" : "Open Claude Desktop"}</button>)}
      </Step>
      {arrival(++n)}
    </ol>
  );
}

function Step({ n, done, title, children }: { n: number; done?: boolean; title: string; children?: ReactNode }) {
  return (
    <li className={"setup-step" + (done ? " done" : "")}>
      <span className="step-no">{done ? "✓" : n}</span>
      <div className="step-body">
        <div className="step-title">{title}</div>
        {children}
      </div>
    </li>
  );
}

/** The manual configuration, for people who want to see exactly what is written where. */
export function ManualSetup({ conn }: { conn: AgentConnection | null }) {
  const config = conn ? JSON.stringify(conn.config, null, 2) : "";
  return (
    <div className="connect-panel">
      <div className="subhead">Claude Desktop by hand</div>
      <p className="muted small" style={{ margin: 0 }}>Settings → Developer → Edit Config, then paste this into <code>{conn?.desktop.configPath ?? "claude_desktop_config.json"}</code> and restart Claude Desktop.</p>
      <CopyBox text={config} rows={config.split("\n").length} />
    </div>
  );
}

export function CopyBox({ text, rows }: { text: string; rows: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the box is selectable */ }
  };
  return (
    <div className="copy-box">
      <textarea className="prompt-box" readOnly rows={rows} wrap="off" value={text} style={{ minHeight: 0, whiteSpace: "pre", overflowX: "auto" }} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn" disabled={!text} onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
