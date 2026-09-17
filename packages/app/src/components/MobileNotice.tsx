import { useState } from "react";

const KEY = "taxonomy.mobileNotice";

/** Shown once on small screens; the layout stacks but the plan reads better on a laptop. */
export function MobileNotice() {
  const [show, setShow] = useState(() => {
    try { return window.innerWidth < 760 && localStorage.getItem(KEY) !== "seen"; } catch { return false; }
  });
  if (!show) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, "seen"); } catch {} setShow(false); };
  return (
    <div className="notice mobile-notice">
      <span>Taxonomy is built for a laptop screen. It works here, but the year-by-year plan is easier to read wide.</span>
      <button type="button" className="btn" onClick={dismiss}>Got it</button>
    </div>
  );
}
