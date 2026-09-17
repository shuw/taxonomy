import { useState } from "react";
import { api, ApiError } from "../api.ts";
import { Mark } from "./Mark.tsx";

/** Sign in, or make the account, on a hosted Taxonomy. Nothing else shows until this is done. */
export function Login({ signup, onDone }: { signup: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<"in" | "new">(signup ? "new" : "in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "new") await api.register(email, password); else await api.login(email, password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "Too many attempts. Wait a few minutes and try again." : err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };
  return (
    <div className="login-page">
      <form className="card login" onSubmit={(e) => void submit(e)}>
        <div className="login-head"><Mark /><h1>{mode === "new" ? "Create your account" : "Sign in"}</h1></div>
        <p className="muted small">{mode === "new" ? "Your profiles are yours alone: one account, your own files on this server." : "Your profiles live on this server, behind your account."}</p>
        <label className="field">
          <span className="field-label">Email</span>
          <span className="input-wrap"><input type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></span>
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <span className="input-wrap"><input type="password" autoComplete={mode === "new" ? "new-password" : "current-password"} required value={password} onChange={(e) => setPassword(e.target.value)} /></span>
        </label>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          {signup && <button type="button" className="link" onClick={() => { setMode(mode === "new" ? "in" : "new"); setError(null); }}>{mode === "new" ? "I already have an account" : "Create an account instead"}</button>}
          <span className="spacer" />
          <button type="submit" className="btn primary" disabled={busy || !email || !password}>{busy ? "…" : mode === "new" ? "Create account" : "Sign in"}</button>
        </div>
      </form>
      <p className="login-fine muted small">For understanding, not advice. Estimates from a model of the rules; confirm anything you act on with a tax professional.</p>
    </div>
  );
}
