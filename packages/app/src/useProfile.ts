import { useCallback, useEffect, useRef, useState } from "react";
import { editProfileText, parseProfile, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { api, type ProfileSummary } from "./api.ts";

export interface ProfileFile {
  id: string;
  path: string;
  text: string;
  profile: Profile | null;
  error: string | null;
}

export interface ProfileStore {
  file: ProfileFile | null;
  /** Apply edits locally right away and write them to the file shortly after. */
  edit: (edits: ProfileEdit[]) => void;
  saving: boolean;
}

const WRITE_DELAY_MS = 500;

/** One profile file: loads it, polls for outside edits, and writes edits back with a short debounce. */
export function useProfile(id: string | null, pollMs = 1500): ProfileStore {
  const [file, setFile] = useState<ProfileFile | null>(null);
  const [saving, setSaving] = useState(false);
  const lastMtime = useRef(-1);
  const pendingText = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFile(null);
    lastMtime.current = -1;
    pendingText.current = null;
    if (timer.current) clearTimeout(timer.current);
    if (!id) return;
    let cancelled = false;
    const tick = async () => {
      if (pendingText.current !== null) return; // our own write is in flight; don't clobber it
      try {
        const body = await api.get(id);
        if (cancelled || body.mtime === lastMtime.current) return;
        lastMtime.current = body.mtime;
        try {
          setFile({ id, path: body.path, text: body.text, profile: parseProfile(body.text), error: null });
        } catch (e) {
          setFile((prev) => ({ id, path: body.path, text: body.text, profile: prev?.profile ?? null, error: String((e as Error).message ?? e) }));
        }
      } catch (e) {
        if (!cancelled) setFile((prev) => prev ?? { id, path: "", text: "", profile: null, error: `could not load profile: ${String((e as Error).message ?? e)}` });
      }
    };
    void tick();
    const handle = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(handle); };
  }, [id, pollMs]);

  const write = useCallback(async (text: string) => {
    if (!id) return;
    setSaving(true);
    try {
      const body = await api.put(id, text);
      lastMtime.current = body.mtime;
    } catch (e) {
      setFile((prev) => (prev ? { ...prev, error: `could not save: ${String((e as Error).message ?? e)}` } : prev));
    } finally {
      setSaving(false);
    }
  }, [id]);

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

  return { file, edit, saving };
}

/** The list of profile files, refreshed on a slow poll and on demand. */
export function useProfileList(pollMs = 3000): { list: ProfileSummary[] | null; refresh: () => Promise<ProfileSummary[]> } {
  const [list, setList] = useState<ProfileSummary[] | null>(null);
  const refresh = useCallback(async () => {
    const l = await api.list();
    setList(l);
    return l;
  }, []);
  useEffect(() => {
    void refresh().catch(() => setList([]));
    const handle = setInterval(() => void refresh().catch(() => {}), pollMs);
    return () => clearInterval(handle);
  }, [refresh, pollMs]);
  return { list, refresh };
}
