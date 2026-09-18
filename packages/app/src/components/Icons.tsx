/** The few line icons the top bar needs at phone width, drawn at the button's text size. */
export function Icon({ name, size = 18 }: { name: "theme-auto" | "sun" | "moon" | "history"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "theme-auto": return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" /></svg>;
    case "sun": return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>;
    case "moon": return <svg {...common}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>;
    case "history": return <svg {...common}><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 3.5v5h5" /><path d="M12 7.5V12l3 2" /></svg>;
  }
}
