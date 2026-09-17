import { useContext, useEffect, useState } from "react";
import { api, type HistoryRow } from "../api.ts";
import { ProfileIdContext } from "../persist.ts";
import { ago } from "../hooks/useAgentStatus.ts";
import { clientName } from "./ConnectAgent.tsx";

/** Every save to this profile, newest first, with who made it and what it did; any earlier version can be restored. */
export function HistoryTab() {
  const id = useContext(ProfileIdContext);
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = () => api.history(id).then((r) => { if (!cancelled) setRows(r); }).catch((e) => { if (!cancelled) setError(String((e as Error).message ?? e)); });
    tick();
    const h = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(h); };
  }, [id]);
  const restore = async (at: string) => { try { await api.restore(id, at, rows?.[0]?.at); setConfirm(null); } catch (e) { setError(String((e as Error).message ?? e)); } };
  if (error) return <div className="error">{error}</div>;
  if (!rows) return <div className="muted">Loading…</div>;
  if (rows.length === 0) return <p className="muted">No changes recorded yet. Every save from here on is listed: yours, and anything Claude sends.</p>;
  const days = new Map<string, HistoryRow[]>();
  for (const r of rows) { const d = new Date(r.at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); days.set(d, [...(days.get(d) ?? []), r]); }
  return (
    <>
      <p className="muted small" style={{ margin: 0 }}>Each entry is one save. “Restore” puts the file back the way it was just before that change; the restore is itself recorded, so nothing is lost.</p>
      {[...days.entries()].map(([day, list]) => (
        <div key={day}>
          <div className="subhead">{day}</div>
          <ol className="history">
            {list.map((r) => (
              <li key={r.at} className="history-row">
                <div className="history-when"><span className="mono">{new Date(r.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span><span className="muted small">{ago(new Date(r.at))}</span></div>
                <div className="history-body">
                  <div className="history-actor">{r.actor === "you" ? "You" : clientName(r.actor)}</div>
                  <ul>{r.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </div>
                <div className="history-actions">
                  {r.restorable && (confirm === r.at
                    ? <><button type="button" className="btn primary" onClick={() => void restore(r.at)}>Restore</button><button type="button" className="btn" onClick={() => setConfirm(null)}>Cancel</button></>
                    : <button type="button" className="link" onClick={() => setConfirm(r.at)}>Restore the version before this</button>)}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </>
  );
}
