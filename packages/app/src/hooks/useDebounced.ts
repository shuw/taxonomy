import { useEffect, useRef, useState } from "react";

/** The value once it has stopped changing for `wait` ms, and at least every `maxWait` ms while it keeps changing. */
export function useDebounced<T>(value: T, wait = 100, maxWait = 300): T {
  const [settled, setSettled] = useState(value);
  const since = useRef<number | null>(null);
  useEffect(() => {
    if (Object.is(value, settled)) { since.current = null; return; }
    const now = performance.now();
    since.current ??= now;
    const delay = Math.max(0, Math.min(wait, since.current + maxWait - now));
    const t = setTimeout(() => { since.current = null; setSettled(value); }, delay);
    return () => clearTimeout(t);
  }, [value, settled, wait, maxWait]);
  return settled;
}
