import { useEffect } from "react";

export const TERMS_DATE = "2026-09-18";

/** The terms, short enough to read: a side project, offered as is, and what happens to what you put in it. */
export function TermsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow terms" role="dialog" aria-modal="true" aria-label="Terms of use">
        <div className="modal-head">
          <div><h3>Terms of use</h3><div className="muted small" style={{ margin: 0 }}>Last changed {TERMS_DATE}</div></div>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <p><strong>A side project.</strong> Taxonomy is <a href="https://shuw.github.io" target="_blank" rel="noreferrer">one person's side project</a>, made in spare time and offered free, as is. There are no promises: none that it is correct, complete, or up, and no liability for anything you do with it, as far as the law allows.</p>
          <p><strong>Not advice.</strong> It is a model of the tax rules, for understanding. It is not tax, legal or financial advice and not a filing tool. Confirm anything you act on with a professional.</p>
          <p><strong>What you put in it.</strong> On this server your profiles live in your account and only you can open them. They are not sold, shared or used for anything else. Delete your account and everything in it whenever you like. There is no promise of backups or uptime: everything sits on one small machine, and a side project can break.</p>
          <p><strong>Better still, run your own.</strong> The code is <a href="https://github.com/shuw/taxonomy" target="_blank" rel="noreferrer">open source</a> under the GNU Affero General Public License, and the README shows how to run it on your laptop, where nothing leaves your computer.</p>
          <p><strong>Be reasonable.</strong> Do not try to reach other people's data or to break the server. Accounts that do lose access. You must be 18 or older to use it.</p>
          <p><strong>Changes.</strong> These terms can change; the date above says when. Using the app after a change means you accept it.</p>
        </div>
      </div>
    </div>
  );
}
