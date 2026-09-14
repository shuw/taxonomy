import { useEffect, useState } from "react";
import { parseProfile, type Profile } from "@taxonomy/engine";

export interface ProfileState {
  path: string;
  mtime: number;
  profile: Profile | null;
  error: string | null;
}

/** Fetch the profile file and poll for edits so the picture follows the YAML. */
export function useProfile(pollMs = 1500): ProfileState | null {
  const [state, setState] = useState<ProfileState | null>(null);
  useEffect(() => {
    let cancelled = false;
    let lastMtime = -1;
    const tick = async () => {
      try {
        const res = await fetch("/api/profile");
        const body = (await res.json()) as { path: string; mtime: number; text: string };
        if (cancelled || body.mtime === lastMtime) return;
        lastMtime = body.mtime;
        try {
          setState({ path: body.path, mtime: body.mtime, profile: parseProfile(body.text), error: null });
        } catch (e) {
          setState((prev) => ({ path: body.path, mtime: body.mtime, profile: prev?.profile ?? null, error: String((e as Error).message ?? e) }));
        }
      } catch (e) {
        if (!cancelled) setState((prev) => prev ?? { path: "", mtime: 0, profile: null, error: `could not load profile: ${String(e)}` });
      }
    };
    void tick();
    const id = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollMs]);
  return state;
}
