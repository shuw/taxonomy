import { useEffect } from "react";
import { HistoryTab } from "./HistoryTab.tsx";

/** The change log for this profile, from the top bar. */
export function HistoryModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal history-modal" role="dialog" aria-modal="true" aria-label="History">
        <div className="modal-head">
          <div>
            <h3>History</h3>
            <div className="muted small" style={{ margin: 0 }}>Every change, by you or by Claude. Restore any earlier version.</div>
          </div>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body"><HistoryTab /></div>
      </div>
    </div>
  );
}
