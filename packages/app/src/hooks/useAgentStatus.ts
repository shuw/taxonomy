import { useEffect, useState } from "react";
import { api, type AgentConnection } from "../api.ts";

/** How to connect an agent, and whether one has called in; refreshed while the caller is mounted. */
export interface AgentStatus {
  conn: AgentConnection | null;
  error: string | null;
  lastSeen: Date | null;
  connected: boolean;
  /** Write the Taxonomy entry into Claude Desktop's config. */
  addToDesktop: () => Promise<void>;
  /** Bring Claude Desktop to the front. */
  openDesktop: () => Promise<boolean>;
  /** Start or stop the local HTTP server for claude.ai. */
  serve: (on: boolean) => Promise<void>;
  /** Remember the tunnel's public host with the secret, for every browser. */
  setTunnelHost: (host: string) => Promise<void>;
  busy: boolean;
}

export function useAgentStatus(pollMs = 5000): AgentStatus {
  const [conn, setConn] = useState<AgentConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = () => api.agent().then((c) => { if (!cancelled) { setConn(c); setError(null); } }).catch((e) => { if (!cancelled) setError(String((e as Error).message ?? e)); });
    tick();
    const h = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(h); };
  }, [pollMs]);
  const lastSeen = conn?.lastSeen ? new Date(conn.lastSeen) : null;
  const addToDesktop = async () => { try { setConn(await api.addToDesktop()); setError(null); } catch (e) { setError(String((e as Error).message ?? e)); } };
  const openDesktop = async () => { try { return (await api.openDesktop()).ok; } catch { return false; } };
  const [busy, setBusy] = useState(false);
  const serve = async (on: boolean) => { setBusy(true); try { setConn(await api.serve(on)); setError(null); } catch (e) { setError(String((e as Error).message ?? e)); } finally { setBusy(false); } };
  const setTunnelHost = async (host: string) => { try { setConn(await api.setTunnelHost(host)); } catch (e) { setError(String((e as Error).message ?? e)); } };
  return { conn, error, lastSeen, connected: lastSeen !== null, addToDesktop, openDesktop, serve, setTunnelHost, busy };
}

/** "just now", "3 minutes ago", "yesterday". */
export function ago(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) { const m = Math.round(s / 60); return `${m} minute${m === 1 ? "" : "s"} ago`; }
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? "" : "s"} ago`; }
  const days = Math.round(s / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
