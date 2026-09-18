import { useEffect } from "react";

/** The four reasons, each a picture beside its words. On the front page and behind Help. */
export function HowItWorks() {
  return (
    <div className="how-rows">
      <div className="point"><div className="point-art"><ClaudeSketch /></div><div className="point-text"><h3>Claude does the paperwork</h3><p>Connect the Claude you already use. It reads your return and grant statements, fills the profile in, and answers what-ifs. The engine does the math; Claude never does.</p></div></div>
      <div className="point"><div className="point-art"><TimelineSketch /></div><div className="point-text"><h3>Decisions, not forms</h3><p>Exercise, sell, give or wait. Each is an event on a timeline, priced under the real rules: AMT and its credit, the $100,000 ISO limit, holding periods, the state you live in.</p></div></div>
      <div className="point"><div className="point-art"><ReasonSketch /></div><div className="point-text"><h3>Every number explains itself</h3><p>Click a figure and get the reason in plain English, down to the bracket it landed in and the lines it came from.</p></div></div>
      <div className="point"><div className="point-art"><FileSketch /></div><div className="point-text"><h3>Yours to keep</h3><p>A profile is one file. Run Taxonomy on your laptop and nothing leaves it, or use this server, where only your account can open what you put in.</p></div></div>
    </div>
  );
}

export function HowItWorksModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal medium how" role="dialog" aria-modal="true" aria-label="How it works">
        <div className="modal-head">
          <div><h3>How it works</h3><div className="muted small" style={{ margin: 0 }}>Four things Taxonomy does that a spreadsheet and a filing tool do not.</div></div>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body"><HowItWorks /></div>
      </div>
    </div>
  );
}

const SK = { width: 200, height: 92, viewBox: "0 0 200 92", "aria-hidden": true, className: "point-sketch" } as const;

/** A timeline with three decisions on it. */
function TimelineSketch() {
  return (
    <svg {...SK}>
      <line x1="12" y1="60" x2="188" y2="60" stroke="var(--border)" strokeWidth="2" />
      {[30, 70, 110, 150].map((x, i) => <g key={x}><line x1={x} y1="56" x2={x} y2="64" stroke="var(--muted)" strokeWidth="2" /><text x={x} y="80" textAnchor="middle" fontSize="10" fill="var(--muted)">{2026 + i}</text></g>)}
      <rect x="16" y="22" width="44" height="24" rx="6" fill="var(--surface)" stroke="var(--series-amt)" strokeWidth="2" /><text x="38" y="38" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--ink)">Exercise</text>
      <rect x="92" y="22" width="36" height="24" rx="6" fill="var(--surface)" stroke="var(--series-kept)" strokeWidth="2" /><text x="110" y="38" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--ink)">Sell</text>
      <rect x="136" y="22" width="36" height="24" rx="6" fill="var(--surface)" stroke="var(--series-giving)" strokeWidth="2" /><text x="154" y="38" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--ink)">Give</text>
      <line x1="38" y1="46" x2="30" y2="56" stroke="var(--series-amt)" strokeWidth="2" /><line x1="110" y1="46" x2="110" y2="56" stroke="var(--series-kept)" strokeWidth="2" /><line x1="154" y1="46" x2="150" y2="56" stroke="var(--series-giving)" strokeWidth="2" />
    </svg>
  );
}
/** A number with its reason attached. */
function ReasonSketch() {
  return (
    <svg {...SK}>
      <rect x="12" y="14" width="76" height="40" rx="8" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
      <text x="22" y="30" fontSize="9" fill="var(--muted)">AMT</text><text x="22" y="47" fontSize="15" fontWeight="700" fill="var(--series-amt)">$61,676</text>
      <path d="M88 34 h20" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" /><path d="M104 29 l6 5 -6 5" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="112" y="10" width="78" height="48" rx="8" fill="color-mix(in srgb, var(--series-amt) 12%, var(--surface))" stroke="var(--series-amt)" strokeWidth="2" />
      {[22, 32, 42].map((y, i) => <rect key={y} x="120" y={y} width={[62, 50, 40][i]} height="4" rx="2" fill="var(--muted)" opacity="0.6" />)}
      <text x="100" y="82" textAnchor="middle" fontSize="10" fill="var(--muted)">the reason, in plain English</text>
    </svg>
  );
}
/** A document flowing into the profile through Claude. */
function ClaudeSketch() {
  return (
    <svg {...SK}>
      <path d="M20 14 h34 l14 14 v46 h-48 z" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" strokeLinejoin="round" /><path d="M54 14 v14 h14" fill="none" stroke="var(--border)" strokeWidth="2" />
      {[36, 46, 56].map((y, i) => <rect key={y} x="28" y={y} width={[30, 22, 26][i]} height="4" rx="2" fill="var(--muted)" opacity="0.6" />)}
      <path d="M74 44 h22" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" /><path d="M92 39 l6 5 -6 5" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="116" cy="44" r="12" fill="var(--accent)" /><circle cx="116" cy="44" r="4" fill="var(--surface)" />
      <path d="M134 44 h22" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" /><path d="M152 39 l6 5 -6 5" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {[32, 44, 56].map((y, i) => <rect key={y} x="164" y={y - 4} width="26" height="8" rx="2" fill={["var(--series-regular)", "var(--series-amt)", "var(--series-kept)"][i]} />)}
    </svg>
  );
}
/** One file, on your machine. */
function FileSketch() {
  return (
    <svg {...SK}>
      <rect x="44" y="18" width="112" height="56" rx="8" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
      <rect x="36" y="74" width="128" height="6" rx="3" fill="var(--border)" />
      <path d="M78 34 h30 l10 10 v20 h-40 z" fill="color-mix(in srgb, var(--series-kept) 14%, var(--surface))" stroke="var(--series-kept)" strokeWidth="2" strokeLinejoin="round" />
      <text x="98" y="59" textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--ink)">me.yaml</text>
      <rect x="128" y="46" width="14" height="12" rx="3" fill="var(--ink)" /><path d="M131 46 v-4 a4 4 0 0 1 8 0 v4" fill="none" stroke="var(--ink)" strokeWidth="2" />
    </svg>
  );
}
