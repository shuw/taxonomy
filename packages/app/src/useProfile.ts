import { useCallback, useEffect, useRef, useState } from "react";
import { editProfileText, parseProfile, type Profile, type ProfileEdit } from "@taxonomy/engine";

export interface ProfileFile {
  /** false while the app is still running on the example because data/profile.yaml does not exist yet. */
  exists: boolean;
  path: string;
  text: string;
  profile: Profile | null;
  error: string | null;
}

export interface ProfileStore {
  file: ProfileFile | null;
  /** Apply edits locally right away and write them to the file shortly after. */
  edit: (edits: ProfileEdit[]) => void;
  /** Create data/profile.yaml from the given text (used by the intake). */
  create: (text: string) => Promise<void>;
  saving: boolean;
}

const WRITE_DELAY_MS = 500;

export function useProfile(pollMs = 1500): ProfileStore {
  const [file, setFile] = useState<ProfileFile | null>(null);
  const [saving, setSaving] = useState(false);
  const lastMtime = useRef(-1);
  const pendingText = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((exists: boolean, path: string, text: string) => {
    try {
      setFile({ exists, path, text, profile: parseProfile(text), error: null });
    } catch (e) {
      setFile((prev) => ({ exists, path, text, profile: prev?.profile ?? null, error: String((e as Error).message ?? e) }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (pendingText.current !== null) return; // our own write is in flight; don't clobber it
      try {
        const res = await fetch("/api/profile");
        const body = (await res.json()) as { exists: boolean; path: string; mtime: number; text: string };
        if (cancelled || body.mtime === lastMtime.current) return;
        lastMtime.current = body.mtime;
        apply(body.exists, body.path, body.text);
      } catch (e) {
        if (!cancelled) setFile((prev) => prev ?? { exists: false, path: "", text: "", profile: null, error: `could not load profile: ${String(e)}` });
      }
    };
    void tick();
    const id = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollMs, apply]);

  const write = useCallback(async (text: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const body = (await res.json()) as { mtime?: number; path?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      lastMtime.current = body.mtime ?? lastMtime.current;
      setFile((prev) => (prev ? { ...prev, exists: true, path: body.path ?? prev.path } : prev));
    } catch (e) {
      setFile((prev) => (prev ? { ...prev, error: `could not save: ${String((e as Error).message ?? e)}` } : prev));
    } finally {
      setSaving(false);
    }
  }, []);

  const edit = useCallback((edits: ProfileEdit[]) => {
    setFile((prev) => {
      if (!prev) return prev;
      const text = editProfileText(prev.text, edits);
      pendingText.current = text;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const t = pendingText.current;
        pendingText.current = null;
        if (t !== null) void write(t);
      }, WRITE_DELAY_MS);
      try {
        return { ...prev, text, profile: parseProfile(text), error: null };
      } catch (e) {
        return { ...prev, text, error: String((e as Error).message ?? e) };
      }
    });
  }, [write]);

  const create = useCallback(async (text: string) => {
    apply(true, "data/profile.yaml", text);
    await write(text);
  }, [apply, write]);

  return { file, edit, create, saving };
}
