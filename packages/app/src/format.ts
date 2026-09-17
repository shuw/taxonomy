export { pct } from "@taxonomy/engine";
import type { Line } from "@taxonomy/engine";
import { usd as realUsd, int, pct } from "@taxonomy/engine";

/**
 * Demo mode shows every amount in a made-up currency at a fixed scale, so a screenshot or a
 * screen share never shows real dollars. Ratios, charts and reasons all stay consistent because
 * everything is scaled the same way; only the display changes, never the file.
 */
export const demo = {
  on: (() => { try { return new URLSearchParams(location.search).get("demo") === "1" || localStorage.getItem("taxonomy.demo") === "on"; } catch { return false; } })(),
  symbol: "Ⓣ",
  // A fresh rate every load, so no two screenshots can be lined up to recover the real figures.
  scale: Math.round((0.3 + Math.random() * 0.6) * 1000) / 1000,
};
export function setDemo(on: boolean): void {
  try { localStorage.setItem("taxonomy.demo", on ? "on" : "off"); } catch {}
  const url = new URL(location.href); url.searchParams.delete("demo"); history.replaceState(null, "", url);
  location.reload();
}
const scaled = (n: number) => (demo.on ? n * demo.scale : n);

export const usd = (n: number): string => (demo.on ? realUsd(scaled(n)).replace("$", demo.symbol) : realUsd(n));

/** Dollar amounts inside prose (a line's reason, the Ask text) follow demo mode too. */
export function demoText(s: string): string {
  if (!demo.on) return s;
  return s.replace(/\$([\d,]+(?:\.\d+)?)([kKmM]?)\b/g, (_m, num: string, suf: string) => {
    const v = Number(num.replace(/,/g, "")) * demo.scale;
    const text = suf ? (Math.round(v * 10) / 10).toString() : int(v);
    return `${demo.symbol}${text}${suf}`;
  });
}

export const shares = (n: number): string => int(n);

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

/** Headline money: whole dollars until a million, then $1.39M, so a big number stays one glance wide. */
export function usdHeadline(n0: number): string {
  const n = scaled(n0);
  const abs = Math.abs(n);
  if (abs < 1_000_000) return usd(n0);
  const sym = demo.on ? demo.symbol : "$";
  return `${n < 0 ? "−" : ""}${sym}${(abs / 1_000_000).toFixed(abs >= 100_000_000 ? 0 : 2)}M`;
}

/** Compact currency for chart labels: $81k, $1.2M. */
export function usdCompact(n0: number): string {
  const n = scaled(n0);
  const sym = demo.on ? demo.symbol : "$";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const text = k >= 100 ? k.toFixed(0) : Number.isInteger(Math.round(k * 10) / 10) ? String(Math.round(k)) : (Math.round(k * 10) / 10).toFixed(1);
    return `${sign}${sym}${text}k`;
  }
  return `${sign}${sym}${Math.round(abs)}`;
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
