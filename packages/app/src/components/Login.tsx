import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api.ts";
import { Disclaimer } from "./Disclaimer.tsx";
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
  return (
    <div className="login-page">
      <form className="card login" onSubmit={(e) => void submit(e)}>
        <div className="brand login-brand"><Mark size={28} /><Wordmark /></div>
        <p className="login-tagline">See what the next few years of income and equity will cost in tax, and what each decision changes.</p>
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
      </form>
      <div className="login-fine"><Disclaimer /></div>
    </div>
  );
}
