import { useEffect, useState } from "react";
import { api, type AgentConnection } from "../api.ts";

/** The "Connect your agent" tab: how to point Claude Desktop, Claude Code or the web at Taxonomy's MCP server. */
export function ConnectAgent() {
  const [conn, setConn] = useState<AgentConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.agent().then(setConn).catch((e) => setError(String((e as Error).message ?? e))); }, []);
  const config = conn ? JSON.stringify(conn.config, null, 2) : "";
  const codeCommand = conn ? `claude mcp add taxonomy -- ${conn.command} ${conn.script}` : "";
  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        Talk to your plan from the Claude you already use. Taxonomy includes a small local server your agent can call: it reads the plan,
        explains any number with the reason behind it, tries what-ifs, and proposes scenarios that show up here for you to accept.
        The agent never does tax math and never edits your facts; documents still go through the same intake review as "Fill from documents".
      </p>
      <div className="notice">Try: "Exercise 2,000 ISOs next year and sell half the year after." · "What's the most I can exercise in 2027 without AMT?" · "Why is 2027 so much higher than 2026?" · "How long until the credit comes back?" · "Read my new pay stub and update my salary."</div>
      {error && <div className="error">Could not read the connection details: {error}</div>}

      <div className="subhead">Claude Desktop</div>
      <ol className="how-to">
        <li>In Claude Desktop open Settings, then Developer, then Edit Config. It opens <code>claude_desktop_config.json</code>.</li>
        <li>Paste this in. If the file already has an <code>mcpServers</code> entry, add the <code>taxonomy</code> line inside it.</li>
        <li>Quit and reopen Claude Desktop. A hammer or tools icon shows Taxonomy's tools; ask it to start with your plan.</li>
      </ol>
      <CopyBox text={config} rows={config.split("\n").length} />

      <div className="subhead">Claude Code</div>
      <p className="muted small" style={{ margin: 0 }}>Opening Claude Code in this folder finds the server through the repository's <code>.mcp.json</code>. From anywhere else, run:</p>
      <CopyBox text={codeCommand} rows={2} />

      <div className="subhead">Claude on the web</div>
      <p className="muted small" style={{ margin: 0 }}>
        claude.ai cannot reach a program on your computer, so it cannot read or change the plan. "Ask your agent" on the plan card copies a
        question with the plan's numbers in it; paste that for an answer grounded in this plan. To have the agent propose scenarios, use Claude Desktop or Claude Code.
      </p>
      {conn && <p className="muted small" style={{ margin: 0 }}>The server runs <code>{conn.script}</code> with <code>{conn.command}</code> and reads the profile files in <code>{conn.root}/data/profiles</code>. Nothing leaves this machine except what your agent shows you.</p>}
    </>
  );
}

function CopyBox({ text, rows }: { text: string; rows: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the box is selectable */ }
  };
  return (
    <div className="copy-box">
      <textarea className="prompt-box" readOnly rows={rows} value={text} style={{ minHeight: 0 }} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn" disabled={!text} onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
