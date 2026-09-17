import { createContext, useContext, useState } from "react";

/** Profile id used to namespace remembered UI state; set once per workspace. */
export const ProfileIdContext = createContext<string>("default");

/** Forget every remembered view setting; the profile choice and the theme stay. */
export function clearRemembered(): void {
  try {
    const keep = new Set(["taxonomy.profile", "taxonomy.theme"]);
    for (const k of Object.keys(localStorage)) if (k.startsWith("taxonomy.") && !keep.has(k)) localStorage.removeItem(k);
  } catch {}
}
// A reset asked for just before a reload finishes here, before any component can write state back.
try { if (sessionStorage.getItem("taxonomy.reset")) { sessionStorage.removeItem("taxonomy.reset"); clearRemembered(); } } catch {}

/** Write a remembered value for a profile from outside a component, in the same place usePersisted reads it. */
export function setPersisted(id: string, key: string, value: unknown): void {
  try { localStorage.setItem(`taxonomy.${id}.${key}`, JSON.stringify(value)); } catch {}
}

/** Like useState, but remembered in this browser per profile so a refresh lands where you were. */
export function usePersisted<T>(key: string, initial: T | (() => T), validate?: (v: unknown) => v is T): [T, (v: T | ((prev: T) => T)) => void] {
  const id = useContext(ProfileIdContext);
  const full = `taxonomy.${id}.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(full);
      if (raw !== null) { const v = JSON.parse(raw); if (!validate || validate(v)) return v as T; }
    } catch {}
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  const set = (v: T | ((prev: T) => T)) => setValue((prev) => {
    const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
    try { localStorage.setItem(full, JSON.stringify(next)); } catch {}
    return next;
  });
  return [value, set];
}
