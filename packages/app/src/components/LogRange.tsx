/**
 * A shares slider with a logarithmic feel: the left half of the track covers the small counts
 * in fine steps, the right half sweeps up to everything. The input's own value is a position;
 * the share count is derived from it, so the number box and the AMT mark stay exact.
 */
const K = 3; // curvature: at the midpoint the slider reads about 18% of the maximum
const RES = 1000;
const curve = (t: number) => (Math.exp(K * t) - 1) / (Math.exp(K) - 1);
const uncurve = (f: number) => Math.log(1 + f * (Math.exp(K) - 1)) / K;

/** Track position (0..1) for a share count. */
export const positionOf = (shares: number, max: number) => (max > 0 ? uncurve(Math.min(1, Math.max(0, shares / max))) : 0);

export function LogRange({ max, value, step, disabled, onChange }: { max: number; value: number; step: number; disabled?: boolean; onChange: (shares: number) => void }) {
  const pos = positionOf(value, max);
  // A small lot cannot step by 10 or 50; never fewer than about twenty positions on the track.
  const inc = Math.max(1, Math.min(step, Math.floor(max / 20)));
  const fromPosition = (p: number) => {
    if (p >= RES) return max;
    const raw = curve(p / RES) * max;
    return Math.min(max, Math.round(raw / inc) * inc);
  };
  return (
    <input type="range" className="range" min={0} max={RES} step={1} value={Math.round(pos * RES)} disabled={disabled || max === 0}
      style={{ "--pct": `${pos * 100}%` } as React.CSSProperties}
      onChange={(e) => onChange(fromPosition(Number(e.target.value)))} />
  );
}
