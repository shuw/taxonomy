import { useState } from "react";
import { nextTrivia } from "../whimsy.ts";
import { keyLabel, type Shortcut } from "../hooks/useShortcuts.ts";

/** The list behind "?": every shortcut with its keys. */
export function ShortcutsHelp({ shortcuts, onClose }: { shortcuts: Shortcut[]; onClose: () => void }) {
  const [fact] = useState(nextTrivia);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="modal-head">
          <div><h3>Keyboard shortcuts</h3></div>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <table className="shortcuts">
            <tbody>
              {shortcuts.map((s) => (
                <tr key={s.label}>
                  <td>{s.keys.map((k) => <kbd key={k}>{keyLabel(k)}</kbd>)}</td>
                  <td>{s.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="trivia muted small">{fact.text} <span className="source">{fact.source}</span></p>
        </div>
      </div>
    </div>
  );
}
