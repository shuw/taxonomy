import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api.ts";
import { Disclaimer } from "./Disclaimer.tsx";
import { TermsModal } from "./TermsModal.tsx";
import { Mark, Wordmark } from "./Mark.tsx";

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Sign in, or make the account, on a hosted Taxonomy. One form: once the address is known, the card says which it will do. */
export function Login({ signup, full, onDone }: { signup: boolean; full?: boolean; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // What the server knows about the address typed so far: an account, none, or not asked yet.
  const [known, setKnown] = useState<{ email: string; exists: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [terms, setTerms] = useState(false);

  const exists = known && known.email === email.trim().toLowerCase() ? known.exists : null;
  const mode: "in" | "new" | "ask" = !signup ? "in" : exists === null ? "ask" : exists ? "in" : "new";

  // Ask about the address a moment after it stops changing, and again on Tab or Enter.
  const lookup = async (value: string) => {
    if (!signup || !looksLikeEmail(value)) return null;
    try { const r = await api.lookup(value); if (r.exists !== null) setKnown({ email: value.trim().toLowerCase(), exists: r.exists }); return r.exists; } catch { return null; }
  };
  useEffect(() => {
    if (!signup || !looksLikeEmail(email) || exists !== null) return;
    const t = setTimeout(() => void lookup(email), 400);
    return () => clearTimeout(t);
  }, [email, signup, exists]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const has = mode === "ask" ? await lookup(email) : exists;
      if (signup && has === false) await api.register(email, password); else await api.login(email, password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "Too many attempts. Wait a few minutes and try again." : err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };

  const title = mode === "new" ? "Create your account" : mode === "in" ? (signup ? "Welcome back" : "Sign in") : "Sign in or create an account";
  const blurb = !signup
    ? full ? "This server is full, so no new accounts right now." : "Sign-up is closed; ask whoever runs this server for an account."
    : mode === "new" ? "New here. Pick a password and the account is yours."
    : mode === "in" ? "This address has an account."
    : "Your email, then a password. New addresses get an account.";
  const card = (
    <form className="card login" onSubmit={(e) => void submit(e)}>
      <h1 className="login-title">{title}</h1>
      <p className="muted small">{blurb}</p>
      <label className="field">
        <span className="field-label">Email</span>
        <span className="input-wrap"><input type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Tab") { void lookup(email); if (e.key === "Enter") { e.preventDefault(); passwordRef.current?.focus(); } } }} /></span>
      </label>
      <label className="field">
        <span className="field-label">Password</span>
        <span className="input-wrap"><input ref={passwordRef} type="password" autoComplete={mode === "new" ? "new-password" : "current-password"} required value={password} onChange={(e) => setPassword(e.target.value)} /></span>
      </label>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <span className="spacer" />
        <button type="submit" className="btn primary" disabled={busy || !email || !password}>{busy ? "…" : mode === "new" ? "Create account" : mode === "in" ? "Sign in" : "Continue"}</button>
      </div>
      <p className="muted small login-terms">A side project, offered as is. By continuing you accept the <button type="button" className="link" onClick={() => setTerms(true)}>terms of use</button>.</p>
    </form>
  );
  return (
    <div className="landing">
      <header className="landing-top"><div className="brand"><Mark size={26} /><Wordmark /></div></header>
      <section className="landing-hero">
        <div className="pitch">
          <h2>See your taxes before they happen.</h2>
          <p>Salary, options and RSUs become a plan you can push on: move a lever, watch six years of federal and state tax respond, and click any number to read why it is what it is. Connect the Claude you already use and it fills the plan in from your documents.</p>
          <PlanSketch />
          <div className="pitch-actions"><a className="btn primary big" href="/demo">Try the demo</a><span className="muted small">No account, nothing to install. Two minutes.</span></div>
        </div>
        {card}
      </section>
      <section className="landing-points">
        <div className="points-head"><h2>How it works</h2><p>Four things Taxonomy does that a spreadsheet and a filing tool do not.</p></div>
        <div className="point"><div className="point-art"><ClaudeSketch /></div><div className="point-text"><h3>Claude does the paperwork</h3><p>Connect the Claude you already use. It reads your return and grant statements, fills the profile in, and answers what-ifs. The engine does the math; Claude never does.</p></div></div>
        <div className="point"><div className="point-art"><TimelineSketch /></div><div className="point-text"><h3>Decisions, not forms</h3><p>Exercise, sell, give or wait. Each is an event on a timeline, priced under the real rules: AMT and its credit, the $100,000 ISO limit, holding periods, the state you live in.</p></div></div>
        <div className="point"><div className="point-art"><ReasonSketch /></div><div className="point-text"><h3>Every number explains itself</h3><p>Click a figure and get the reason in plain English, down to the bracket it landed in and the lines it came from.</p></div></div>
        <div className="point"><div className="point-art"><FileSketch /></div><div className="point-text"><h3>Yours to keep</h3><p>A profile is one file. Run Taxonomy on your laptop and nothing leaves it, or use this server, where only your account can open what you put in.</p></div></div>
      </section>
      <footer className="landing-foot">
        <Disclaimer />
        <p className="muted small">A <a href="https://shuw.github.io" target="_blank" rel="noreferrer">side project</a>, built between tax seasons. Open source under the AGPL-3.0. <a className="link" href="https://github.com/shuw/taxonomy" target="_blank" rel="noreferrer">Source</a> · <button type="button" className="link" onClick={() => setTerms(true)}>Terms of use</button></p>
      </footer>
      {terms && <TermsModal onClose={() => setTerms(false)} />}
    </div>
  );
}

/** A picture of the plan as the app draws it: five years, one with AMT, the focused year with its decision underneath. Decorative. */
function PlanSketch() {
  // Thousands: regular tax, AMT, exercise cost, kept. The picture is the demo profile's shape, not its numbers.
  const years = [
    { year: 2026, regular: 62, amt: 62, exercise: 24, kept: 134, label: ["$134k kept", "$125k tax"], chip: { text: "Exercise ISO · 20k", color: "var(--series-amt)" } },
    { year: 2027, regular: 80, amt: 0, exercise: 39, kept: 226, label: ["$226k kept", "$81k tax"], chip: { text: "Exercise NSO · 6k", color: "var(--series-violet)" } },
    { year: 2028, regular: 172, amt: 0, exercise: 0, kept: 185, label: ["$185k kept", "$172k tax"], chip: { text: "Give · $25k stock", color: "var(--series-giving)" }, note: "RSUs settle" },
    { year: 2029, regular: 135, amt: 0, exercise: 0, kept: 819, label: ["$819k kept", "$135k tax"], chip: { text: "Sell · 15k · $586k", color: "var(--series-kept)" } },
    { year: 2030, regular: 88, amt: 0, exercise: 0, kept: 291, label: ["$291k kept", "$88k tax"] },
  ] as { year: number; regular: number; amt: number; exercise: number; kept: number; label: string[]; chip?: { text: string; color: string }; note?: string }[];
  const W = 560, H = 318, left = 52, top = 54, bottom = 92, band = (W - left - 12) / years.length, bw = 58, max = 1000;
  const plotH = H - top - bottom, base = top + plotH;
  const yOf = (v: number) => base - (v / max) * plotH;
  const ticks = [0, 250, 500, 750, 1000];
  return (
    <svg className="plan-sketch" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <defs>
        <pattern id="sketch-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--series-kept)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="2" /></pattern>
      </defs>
      <rect x={left + 2} y={8} width={band - 4} height={H - 16} rx="14" fill="var(--accent)" opacity="0.10" />
      {ticks.map((t) => <g key={t}><line x1={left} x2={W - 12} y1={yOf(t)} y2={yOf(t)} stroke="var(--border)" strokeWidth="1" /><text x={left - 8} y={yOf(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t === 0 ? "$0" : t === 1000 ? "$1.0M" : `$${t}k`}</text></g>)}
      {years.map((y, i) => {
        const cx = left + band * i + band / 2, x = cx - bw / 2;
        const segs = [
          { v: y.regular, fill: "var(--series-regular)" }, { v: y.amt, fill: "var(--series-amt)" }, { v: y.exercise, fill: "var(--series-violet)" }, { v: y.kept, fill: "url(#sketch-hatch)" },
        ].filter((sg) => sg.v > 0);
        let acc = 0;
        const total = segs.reduce((s, sg) => s + sg.v, 0);
        return (
          <g key={y.year}>
            {segs.map((sg, j) => { const y0 = yOf(acc), y1 = yOf(acc + sg.v); acc += sg.v; const last = j === segs.length - 1; const h = Math.max(0, y0 - y1 - (last ? 0 : 2)); return last
              ? <path key={j} d={`M${x} ${y0} v${-(h - 5)} a5 5 0 0 1 5 -5 h${bw - 10} a5 5 0 0 1 5 5 v${h - 5} z`} fill={sg.fill} />
              : <rect key={j} x={x} y={y1 + 2} width={bw} height={h} fill={sg.fill} />; })}
            <text x={cx} y={yOf(total) - 22} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--series-kept)">{y.label[0]}</text>
            <text x={cx} y={yOf(total) - 8} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink)">{y.label[1]}</text>
            <text x={cx} y={base + 20} textAnchor="middle" fontSize="13" fontWeight={i === 0 ? 700 : 500} fill={i === 0 ? "var(--accent)" : "var(--muted)"}>{y.year}</text>
            <circle cx={cx} cy={base + 42} r="9" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="2 2" /><text x={cx} y={base + 46} textAnchor="middle" fontSize="12" fill="var(--muted)">+</text>
          </g>
        );
      })}
      {years.map((y, i) => {
        const cx = left + band * i + band / 2, cw = band - 10;
        return (
          <g key={y.year}>
            {y.chip && <><rect x={cx - cw / 2} y={base + 56} width={cw} height={18} rx="5" fill="var(--surface)" stroke={y.chip.color} strokeWidth="1.5" /><rect x={cx - cw / 2} y={base + 56} width={3} height={18} rx="1.5" fill={y.chip.color} /><text x={cx - cw / 2 + 8} y={base + 68.5} fontSize="9" fontWeight="600" fill="var(--ink)">{y.chip.text}</text></>}
            {y.note && <text x={cx - cw / 2 + 2} y={base + 88} fontSize="9.5" fill="var(--muted)">• {y.note}</text>}
          </g>
        );
      })}
    </svg>
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
