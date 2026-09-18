import { keyLabel, type Shortcut } from "../hooks/useShortcuts.ts";

/** Help, behind "?": the keyboard shortcuts, then where to read about the model and how to reach the project. */
export function ShortcutsHelp({ shortcuts, onClose, onRules, onTerms }: { shortcuts: Shortcut[]; onClose: () => void; onRules: () => void; onTerms: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow help" role="dialog" aria-modal="true" aria-label="Help">
        <div className="modal-head">
          <div><h3>Help</h3></div>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <section>
            <div className="subhead">Keyboard shortcuts</div>
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
          </section>
          <section>
            <div className="subhead">About the numbers</div>
            <ul className="help-list">
              <li><button type="button" className="link" onClick={onRules}>Tax rules this tool models</button><span className="muted small">Every rule and threshold the plan is computed from.</span></li>
            </ul>
          </section>
          <section>
            <div className="subhead">The project</div>
            <ul className="help-list">
              <li><a className="link" href="https://github.com/shuw/taxonomy" target="_blank" rel="noreferrer">Source code</a><span className="muted small">Open source on GitHub, under the AGPL-3.0.</span></li>
              <li><a className="link" href="https://github.com/shuw/taxonomy/issues" target="_blank" rel="noreferrer">Send feedback</a><span className="muted small">A wrong number, a problem, an idea.</span></li>
              <li><button type="button" className="link" onClick={onTerms}>Terms of use</button><span className="muted small">A side project, offered as is; what happens to what you put in it.</span></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
