import { useEffect, useState } from "react";
import { nextTrivia } from "../whimsy.ts";
import { modeledRules } from "@taxonomy/engine";

/** What the engine models, from its own parameters for the plan's first year. Reached from the ? dialog. */
export function RulesModal({ year, inflation, onClose }: { year: number; inflation: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const groups = modeledRules(year, inflation);
  const [fact] = useState(nextTrivia);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal medium rules" role="dialog" aria-modal="true" aria-label="Rules the engine models">
        <div className="modal-head">
          <div><h3>Tax rules in the model</h3><div className="muted small" style={{ margin: 0 }}>Everything the plan is computed from, with the {year} figures it uses. Your situation may have more to it; a tax professional confirms what applies.</div></div>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {groups.map((g) => (
            <section key={g.title} className="rule-group">
              <h4>{g.title}</h4>
              <dl>
                {g.items.map((i) => (
                  <div key={i.name} className="rule">
                    <dt>{i.name}</dt>
                    <dd>{i.detail}{i.source && <span className="rule-source">{i.source}</span>}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="trivia muted small">{fact.text} <span className="source">{fact.source}</span></p>
        </div>
      </div>
    </div>
  );
}
