import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Field } from "./fields.tsx";

interface Props { email: string; signOut: () => Promise<void>; deleteAccount: (password: string) => Promise<void>; onClose: () => void; }

/** The account behind a hosted Taxonomy: sign out, a new password, or delete it all. Reached from the profile menu. */
export function AccountModal({ email, signOut, deleteAccount, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal account" role="dialog" aria-modal="true" aria-label="Account">
        <div className="modal-head">
          <div>
            <h3>Account</h3>
            <div className="muted small" style={{ margin: 0 }}>Signed in as {email}</div>
          </div>
          <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <PasswordForm />
          <DeleteForm deleteAccount={deleteAccount} />
        </div>
      </div>
    </div>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: boolean }>({});
  const submit = async () => {
    setState({ busy: true });
    try { await api.changePassword(current, next); setState({ done: true }); setCurrent(""); setNext(""); }
    catch (e) { setState({ error: String((e as Error).message ?? e) }); }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="subhead">Change password</div>
      <div className="row3">
        <Field label="Current password"><span className="input-wrap"><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></span></Field>
        <Field label="New password"><span className="input-wrap"><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></span></Field>
        <div className="modal-actions" style={{ alignSelf: "end" }}><button type="submit" className="btn primary" disabled={state.busy || !current || !next}>{state.busy ? "…" : "Change"}</button></div>
      </div>
      {state.error && <div className="field-error">{state.error}</div>}
      {state.done && <p className="muted small">Changed. Other devices are signed out.</p>}
    </form>
  );
}

function DeleteForm({ deleteAccount }: { deleteAccount: (password: string) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  const remove = async () => {
    setState({ busy: true });
    try { await deleteAccount(password); } catch (e) { setState({ error: String((e as Error).message ?? e) }); }
  };
  return (
    <div>
      <div className="subhead">Delete this account</div>
      <p className="muted small">Removes every profile, its history and documents, and the Claude connection. There is no way back.</p>
      {!confirming ? (
        <button type="button" className="btn danger" onClick={() => setConfirming(true)}>Delete my account…</button>
      ) : (
        <form className="row3" onSubmit={(e) => { e.preventDefault(); void remove(); }}>
          <Field label="Your password" hint="to confirm"><span className="input-wrap"><input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></span></Field>
          <div className="modal-actions" style={{ alignSelf: "end" }}>
            <button type="button" className="btn" onClick={() => { setConfirming(false); setPassword(""); setState({}); }}>Keep it</button>
            <button type="submit" className="btn danger" disabled={state.busy || !password}>{state.busy ? "…" : "Delete everything"}</button>
          </div>
          {state.error && <div className="field-error">{state.error}</div>}
        </form>
      )}
    </div>
  );
}
