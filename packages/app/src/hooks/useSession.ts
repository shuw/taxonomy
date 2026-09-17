import { useCallback, useEffect, useState } from "react";
import { api, SIGNED_OUT, type Session } from "../api.ts";

/** Whether this server has accounts, and who is signed in. `null` until the server has answered. */
export function useSession(): { session: Session | null; refresh: () => Promise<void>; signOut: () => Promise<void> } {
  const [session, setSession] = useState<Session | null>(null);
  const refresh = useCallback(async () => {
    try { setSession(await api.me()); } catch { setSession({ enabled: false, user: null, signup: false }); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // A 401 from any call means the session ended elsewhere (expiry, a password change, sign-out in another tab).
  useEffect(() => {
    const onOut = () => setSession((s) => (s && s.enabled ? { ...s, user: null } : s));
    window.addEventListener(SIGNED_OUT, onOut);
    return () => window.removeEventListener(SIGNED_OUT, onOut);
  }, []);
  const signOut = useCallback(async () => { try { await api.logout(); } catch {} await refresh(); }, [refresh]);
  return { session, refresh, signOut };
}
