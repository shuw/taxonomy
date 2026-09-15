/** The Flow T: income enters along the crossbar and splits into regular tax, AMT, and what you keep. */
export function Mark({ size = 22 }: { size?: number }) {
  const heavy = size < 28;
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x={heavy ? 4 : 6} y={heavy ? 6 : 8} width={heavy ? 56 : 52} height={heavy ? 14 : 12} rx="4" fill="currentColor" />
      <path d={heavy ? "M18 20C18 36 10 38 10 56" : "M20 20C20 36 12 38 12 56"} stroke="var(--series-amt)" strokeWidth={heavy ? 10 : 8} strokeLinecap="round" fill="none" />
      <path d={heavy ? "M46 20C46 36 54 38 54 56" : "M44 20C44 36 52 38 52 56"} stroke="var(--surface-3)" strokeWidth={heavy ? 10 : 8} strokeLinecap="round" fill="none" />
      <path d="M32 20V56" stroke="var(--series-regular)" strokeWidth={heavy ? 12 : 10} strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  return <span className="word"><span className="tax">Tax</span><span className="rest">onomy</span></span>;
}
