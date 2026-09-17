import { useEffect, useState } from "react";
import { api, type HistoryRow } from "../api.ts";
import { usePersisted } from "../persist.ts";

/** Changes Claude made to this profile since you last looked, from the history log. */
export function useClaudeNews(profileId: string, pollMs = 5000): { news: HistoryRow[]; markSeen: () => void } {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [seenAt, setSeenAt] = usePersisted<string>("claudeSeenAt", "", (v): v is string => typeof v === "string");
  useEffect(() => {
    let cancelled = false;
    const tick = () => api.history(profileId).then((r) => { if (!cancelled) setRows(r); }).catch(() => {});
    tick();
    const h = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(h); };
  }, [profileId, pollMs]);
  const news = rows.filter((r) => r.actor !== "you" && r.at > seenAt);
  const markSeen = () => { if (rows[0]) setSeenAt(rows[0].at); };
  return { news, markSeen };
}
