export { usd, pct } from "@taxonomy/engine";
import type { Line } from "@taxonomy/engine";
import { usd, pct } from "@taxonomy/engine";

export const shares = (n: number): string => Math.round(n).toLocaleString("en-US");

export function fmtLine(line: Line): string {
  switch (line.unit) {
    case "rate": return pct(line.value);
    case "shares": return shares(line.value);
    case "flag": return line.value ? "yes" : "no";
    default: return usd(line.value);
  }
}

export function fmtDelta(delta: number, unit: Line["unit"] = "usd"): string {
  if (Math.abs(delta) < 0.5 && unit !== "rate") return "";
  const sign = delta > 0 ? "+" : "-";
  const abs = Math.abs(delta);
  if (unit === "rate") return abs < 0.0005 ? "" : `${sign}${(abs * 100).toFixed(1)} pt`;
  if (unit === "shares") return `${sign}${shares(abs)}`;
  return `${sign}${usd(abs)}`;
}

/** Compact currency for chart labels: $81k, $1.2M. */
export function usdCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const text = k >= 100 ? k.toFixed(0) : Number.isInteger(Math.round(k * 10) / 10) ? String(Math.round(k)) : (Math.round(k * 10) / 10).toFixed(1);
    return `${sign}$${text}k`;
  }
  return `${sign}$${Math.round(abs)}`;
}

/** Round-number axis ticks: 0..max in 3–5 clean steps. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? mag * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  if ((ticks[ticks.length - 1] ?? 0) < max) ticks.push((ticks[ticks.length - 1] ?? 0) + step);
  return ticks;
}
