import { useState } from "react";

/** Dialog state lives in the URL hash so a refresh lands you where you were. */
export function setHash(name: string | null) {
  const url = new URL(location.href);
  url.hash = name ? `#${name}` : "";
  history.replaceState(null, "", url);
}

/** State mirrored into the hash: `parse` reads it from the current hash, `format` writes it back (null clears the hash). */
export function useHashState<T>(parse: (hash: string) => T, format: (value: T) => string | null): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => parse(location.hash));
  const set = (v: T) => { setValue(v); setHash(format(v)); };
  return [value, set];
}
