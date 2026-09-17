import { useEffect, useRef, useState } from "react";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that rolls to its new value instead of jumping, so a change reads as a change. */
export function useAnimatedNumber(value: number, ms = 450): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const current = useRef(value);
  useEffect(() => {
    if (reduced() || from.current === value) { from.current = value; setShown(value); return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      current.current = a + (value - a) * eased;
      setShown(current.current);
      if (t < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    // An interrupted roll continues from where it is on screen, not from where it was going.
    return () => { cancelAnimationFrame(raf); from.current = current.current; };
  }, [value, ms]);
  return shown;
}
