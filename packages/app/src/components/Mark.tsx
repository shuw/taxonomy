import { useRef, useState } from "react";
/**
 * The rolling coin: a stack of coins with the top one tipping off. What you keep stays stacked;
 * the tax rolls away. Small sizes drop the motion marks and one coin so the shape stays clear.
 */
export function Mark({ size = 22 }: { size?: number }) {
  const small = size <= 20;
  const sw = small ? 5 : 4;
  const coin = (y: number, fill: string, extra = "") => <rect className="coin" x="10" y={y} width="34" height="10" rx="5" fill={fill} stroke="var(--ink)" strokeWidth={sw} strokeLinejoin="round" {...(extra ? { transform: extra } : {})} />;
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {!small && coin(44, "var(--series-regular)")}
      {coin(small ? 44 : 33, "var(--series-regular)")}
      {coin(small ? 33 : 22, "var(--series-kept)")}
      <rect className="coin tip" x="18" y={small ? 16 : 8} width="34" height="10" rx="5" fill="var(--series-amt)" stroke="var(--ink)" strokeWidth={sw} strokeLinejoin="round" transform={`rotate(-18 35 ${small ? 21 : 13})`} />
      {!small && <path d="M52 4l4 4M56 4l-4 4" stroke="var(--series-amt)" strokeWidth="3" strokeLinecap="round" />}
    </svg>
  );
}

/** Hold the wordmark for three seconds and it briefly becomes a different trade. */
export function Wordmark() {
  const [flipped, setFlipped] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = () => { timer.current = setTimeout(() => { setFlipped(true); setTimeout(() => setFlipped(false), 1400); }, 3000); };
  const release = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  return (
    <span className={"word" + (flipped ? " flipped" : "")} onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}>
      <span className="tax">Tax</span><span className="rest">{flipped ? "idermy" : "onomy"}</span>
    </span>
  );
}
